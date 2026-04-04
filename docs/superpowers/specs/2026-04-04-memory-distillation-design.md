# Memory Distillation Design


## Problem

Memories can become stale weeks after the codebase has moved on — files removed, dependencies swapped, patterns abandoned. Without periodic validation against ground truth, the memory system accumulates outdated entries that pollute context injection and search results.


## Solution

A periodic, project-scoped distillation process that validates memories against the current codebase state. Triggered by the stop hook when configurable thresholds are met, processed by the background worker in domain-scoped batches using an agentic LLM with read-only codebase access. Stale memories are soft-deleted with a grace period before permanent removal.


## Trigger

The stop hook already POSTs to `/enqueue` with the project path. After the observation queue insertion, the `/enqueue` handler calls `checkDistillationEligibility(projectId)`, which checks two conditions:

1. `distillation_at` is empty OR older than `distillation.minAgeHours` (default: 24)
2. `distillation_memories_since` >= `distillation.minMemoriesSince` (default: 5)

If both pass and no `distillation_queue` entry is already pending for this project, a new queue row is inserted.

The `distillation_memories_since` counter is incremented inside `insertMemory()` in `db.ts` whenever a memory is created for the project. It resets to 0 when a distillation completes.


## Data Model

### New columns on `projects` table

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `distillation_at` | TEXT | `''` | ISO timestamp of last completed distillation |
| `distillation_memories_since` | INTEGER | `0` | Memories added since last distillation |

Added via idempotent migration in `initSchema()` using the existing `PRAGMA table_info` pattern.

### New columns on `memories` table

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `deleted_at` | TEXT | `''` | ISO timestamp of soft-delete (empty = active) |
| `deleted_reason` | TEXT | `''` | LLM-provided reason for deletion |

### New table: `distillation_queue`

```sql
CREATE TABLE IF NOT EXISTS distillation_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_distillation_queue_status ON distillation_queue(status);
```

Same pattern as `observation_queue` and `memory_queue`.

### Search exclusion

All queries that return memories to users add `WHERE deleted_at = ''` to exclude soft-deleted entries. This applies to:

- FTS search (`memories_fts` and `memories_trigram` queries)
- `listMemories()`
- Context injection in `context.ts`
- MCP tools: `search_memories`, `list_memories`


## Configuration

New `distillation` section in `config.ts` Zod schema:

```typescript
const distillationSchema = z.object({
    minAgeHours: z.number().min(1).default(24),
    minMemoriesSince: z.number().min(1).default(5),
    batchSize: z.number().min(1).default(50),
    purgeAfterHours: z.number().min(1).default(168),
});
```

User overrides via `~/.ai-memory/config.yaml`:

```yaml
distillation:
    minAgeHours: 48
    minMemoriesSince: 10
    batchSize: 30
    purgeAfterHours: 24
```


## Worker Processing

### Entry point

New function `processDistillationQueue()` called in the worker tick, after the consolidation check:

```
await processDistillationQueue();
```

### Processing flow

1. Dequeue one `distillation_queue` entry with status `pending`
2. Get the project's `path` and `git_root`
3. Gather the signal bundle (once per project, reused across batches):
   - **Repo tree**: `tree -L 4 --dirsfirst -I 'node_modules|.git|dist'` from `git_root`
   - **Git log**: `git log --after=<distillation_at> --format="%h %s" --stat` from `git_root`. If `distillation_at` is empty (first run), use a 30-day window.
4. Query all active memories (`deleted_at = ''`) for the project, grouped by domain
5. For each domain with memories:
   - Batch in chunks of `batchSize` (default 50)
   - Call LLM with the signal bundle + memory batch
6. Soft-delete memories returned in the LLM's `delete` array
7. Update project: set `distillation_at` to now, reset `distillation_memories_since` to 0
8. Mark queue entry as `done`
9. `broadcast('counts:updated', {})`

### Domain skipping optimization

Before processing a domain batch, check if the git log `--stat` output contains file changes that could be relevant. For v1, this is a simple heuristic: if `distillation_at` is non-empty (not the first run) and the git log since then is empty (zero commits), skip all domains — nothing changed. Beyond that, process all domains with memories. A smarter domain-to-file-pattern filter can be added later if LLM costs become a concern.


## LLM Call

### Model and tools

Uses Haiku via `@anthropic-ai/claude-agent-sdk` with read-only tool access:

```typescript
const { query } = await import('@anthropic-ai/claude-agent-sdk');

for await (const message of query({
    prompt,
    options: {
        allowedTools: ['Read', 'Glob', 'Grep'],
        permissionMode: 'bypassPermissions',
        model: 'haiku',
        workingDir: projectPath,
    },
})) {
    if ('result' in message) result = message.result as string;
}
```

No Bash access — strictly read-only to prevent accidental modifications.

### Prompt

New file: `src/prompts/distill-memories.md`

```markdown
You are reviewing memories for a software project to identify ones that are
outdated, irrelevant, or contradicted by recent changes.

## Project Repository Structure

{{TREE}}

## Changes Since Last Review

{{GIT_LOG}}

## Memories to Evaluate (domain: {{DOMAIN}})

{{MEMORIES}}

## Tools

You have access to explore the project's codebase. Use these tools to verify
memories when the tree and git log alone aren't enough:

- Read a file to check if a pattern or convention still holds
- Grep for a dependency, function name, or import to confirm it still exists
- Glob to check if files matching a pattern are still present

Do NOT exhaustively scan the codebase. Only explore when a specific memory
makes a claim you cannot verify from the tree and git log above.

## Instructions

For each memory, determine if it is still accurate and relevant given the
current repository structure and recent changes.

A memory should be deleted if:
- It references files, dependencies, or patterns that no longer exist
- It contradicts what the git history shows (e.g., a migration happened)
- It describes a temporary state that has been resolved
- It is redundant with another memory in this batch

A memory should be kept if:
- It describes something still true about the project
- You cannot determine its validity from the tree and git log alone (keep, don't guess)
- It captures a preference or decision that isn't invalidated by code changes

Respond with JSON only:
{
    "delete": [
        { "id": <number>, "reason": "<why this memory is outdated>" }
    ]
}

If all memories are still valid, return: { "delete": [] }
Do NOT guess. If uncertain, keep the memory.
```


## Purge Cycle

Added to the worker tick after `purgeStaleObservations()`:

```typescript
const purgedMemories = purgeDeletedMemories();
if (purgedMemories > 0) {
    log('worker', `Purged ${purgedMemories} soft-deleted memories past grace period`);
    broadcast('counts:updated', {});
}
```

`purgeDeletedMemories()` in `db.ts` hard-deletes rows where `deleted_at != ''` and `deleted_at` is older than `distillation.purgeAfterHours`. The existing FTS triggers on the `memories` table handle cleaning up `memories_fts` and `memories_trigram` automatically on DELETE.


## Files to Create or Modify

| File | Change |
|------|--------|
| `src/config.ts` | Add `distillationSchema` and wire into `configSchema` |
| `src/db.ts` | Migrations for new columns/table, `purgeDeletedMemories()`, `checkDistillationEligibility()`, queue helpers, update `insertMemory()` to increment counter, add `deleted_at = ''` filters to memory queries |
| `src/worker.ts` | Add `processDistillationQueue()`, call it in the tick loop |
| `src/app.ts` | Call `checkDistillationEligibility()` in `/enqueue` handler |
| `src/prompts/distill-memories.md` | New prompt template |


## Not in Scope

- Dashboard UI for viewing soft-deleted memories or distillation history
- Manual trigger (MCP tool to force distillation)
- Per-memory scan tracking
- Cross-project distillation
- Domain-to-file-glob mapping (LLM decides relevance from git stat)

These can be added later if needed.
