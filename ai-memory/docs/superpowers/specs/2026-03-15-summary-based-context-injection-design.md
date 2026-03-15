# Summary-Based Context Injection


## Problem

The current `buildStartupContext()` in `src/context.ts` runs on every session start, dynamically querying all memories, selecting top ones by importance within a token budget, and formatting them as structured text. This approach:

- Burns context tokens on formatting overhead (`- [category] (importance) content tags: ...`)
- Cannot synthesize across memories (5 overlapping memories about the same topic each consume tokens)
- Cannot deduplicate against CLAUDE.md (repeats information the user already sees)
- Recomputes from scratch every time, even when nothing changed


## Solution

Replace the "Memories" section of the injected context with a pre-computed, LLM-generated prose summary that is cached per project and only regenerated when memories change. The summary includes inline memory ID citations for traceability.


## Context Injection Flow

1. `buildStartupContext()` is called at session start
2. Fetch all memories for the project (including `_global`)
3. Run them through the existing deterministic formatter to get the formatted output
4. Compute the formatted output's token count using `chars / 4` heuristic
5. If `formattedTokens <= memoryTokenBudget + 200` -> use the deterministic output (everything fits, no LLM needed)
6. If `formattedTokens > threshold` AND `project.summary` exists AND `summary.length / 4 <= memoryTokenBudget + 200` -> inject the pre-computed summary
7. If `formattedTokens > threshold` AND (no summary OR summary exceeds budget) -> use the deterministic output (truncated as today); worker will generate a summary soon

The taxonomy sections (Tags, Available Domains, Available Categories, Tip) continue to be computed dynamically as today, appended after the summary.


## Injected Summary Format

```
## Project Summary
> Below is a synthesis of all memories for this project. References like (#123, #456)
> point to specific memory IDs -- use `search_memories` to query them directly.

[LLM-generated prose with inline memory ID citations, e.g.:
"This is a SolidJS + Hono dashboard project (#12, #15). Key architectural patterns
include contenteditable divs with imperative DOM hydration to avoid cursor jumping
in reactive frameworks (#34). The database uses better-sqlite3 with FTS5 and trigram
indexes (#8, #22)..."]
```

Token budget for the prose portion: the user's configured `memoryTokenBudget` (default 1000) with ~200 tokens tolerance.


## Worker Summary Loop

Piggybacks on the existing `setInterval` poll in `startWorker()`. Check frequency is derived from config:

```typescript
const summaryEvery = Math.round(config.worker.summary.checkIntervalMs / config.worker.pollIntervalMs);
if (pollCount % summaryEvery === 0) {
    await checkProjectSummaries();
}
```

### Check Algorithm

For each project:

1. Compute aggregate hash of all memories `(id, content, tags, domain, category, importance)` ordered by ID, salted with the current `memoryTokenBudget` config value (so a budget change invalidates the hash)
2. If `hash === project.summary_hash` -> skip (nothing changed)
3. If hash differs -> check quiet period: `MAX(created_at, updated_at)` on memories for this project
4. If last activity < `summaryQuietPeriodMs` ago -> skip (still receiving changes)
5. If quiet -> determine delta type from `summary_snapshot`

### Delta Detection

`summary_snapshot` stores a JSON map `{memoryId: contentHash}` representing the state at last summary generation. The per-memory `contentHash` covers all fields that affect summary content: `content`, `tags`, `domain`, `category`, `importance`.

Compare current memory state against snapshot:

- **New IDs** (in current, not in snapshot) = additions
- **Missing IDs** (in snapshot, not in current) = deletions
- **Same ID, different hash** = updates

### Regeneration Strategy

| Condition | Strategy | LLM Input |
|-----------|----------|-----------|
| Any IDs deleted from the snapshot | Full regeneration | All current memories + previous summary + CLAUDE.md chain |
| `incremental_count >= maxIncrementalCycles` | Full regeneration | All current memories + previous summary + CLAUDE.md chain |
| No existing summary | Full regeneration | All current memories + CLAUDE.md chain |
| Additions and/or updates only | Incremental update | Existing summary + delta memories + CLAUDE.md chain |

On full regeneration: `summary_incremental_count` resets to 0.
On incremental update: `summary_incremental_count` increments by 1.

After any successful summary update, call `broadcast('summary:updated', { projectId })` so the dashboard can react if needed.

Full regeneration still receives the previous summary so the LLM can preserve what's still accurate and only adjust what changed.


## `_global` Memories

The existing `listMemories(projectPath)` returns both project-specific and `_global` memories (via `p.path = ? OR p.path = '_global'`). Summaries follow the same convention:

- A project's summary covers its own memories AND `_global` memories
- The `_global` project itself gets its own summary covering only `_global` memories
- Hash computation and snapshot for a project include both scopes
- When a `_global` memory changes, all project summaries that include `_global` will detect the hash change and regenerate

This means a `_global` memory change triggers regeneration for every project. This is acceptable because `_global` changes are infrequent, and the quiet period prevents thrashing.


## CLAUDE.md Deduplication

The summarization prompts include the project's full CLAUDE.md chain. Resolution order:

1. `~/.claude/CLAUDE.md` (user's global instructions)
2. Walk from the project path upward, collecting `CLAUDE.md` files at each directory until a `.git` directory is found (git root) or the filesystem root is reached
3. Concatenate all found files in order (global first, then outermost directory to project-level)

Implementation: `loadClaudeMdChain(projectPath)` uses `existsSync` + `readFileSync` to walk directories. Finding the git root uses `existsSync(join(dir, '.git'))` at each level. If the project path doesn't exist on disk (e.g., `_global`), returns empty string.

Prompt instruction:

> "The following is the project's CLAUDE.md chain, which the user already sees at session start. Do NOT repeat information already covered there. Your summary should only contain knowledge that adds value beyond what CLAUDE.md provides."

For `_global` projects or when no CLAUDE.md files exist, this section is omitted from the prompt.


## Schema Changes

`projects` table -- 4 new columns (idempotent migration in `initSchema()`):

```sql
ALTER TABLE projects ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN summary_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN summary_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN summary_incremental_count INTEGER NOT NULL DEFAULT 0;
```


## Config Changes

New nested section in `worker` config (`src/config.ts`):

```yaml
worker:
  summary:
    quietPeriodMs: 300000         # 5 min of no memory changes before regenerating
    maxIncrementalCycles: 10      # force full regen after N incremental updates
    checkIntervalMs: 60000        # how often to check for stale summaries
```

Zod schema addition:

```typescript
const summarySchema = z.object({
    quietPeriodMs: z.number().min(60000).default(300000),
    maxIncrementalCycles: z.number().min(1).default(10),
    checkIntervalMs: z.number().min(10000).default(60000),
});
```


## New Prompts

### `prompts/summarize-full.md`

Full regeneration prompt. Receives:
- `{{MEMORIES}}` -- all current memories as JSON
- `{{PREVIOUS_SUMMARY}}` -- previous summary text (empty string if first generation)
- `{{CLAUDE_MD}}` -- concatenated CLAUDE.md chain
- `{{TOKEN_BUDGET}}` -- target token count for the output

Instructions:
- Generate a prose summary of all memories within the token budget
- Include memory ID references inline as `(#id, #id)`
- Do not repeat information already in CLAUDE.md
- If a previous summary exists, preserve what's still accurate
- Prioritize higher-importance memories
- Group related information thematically

### `prompts/summarize-incremental.md`

Incremental update prompt. Receives:
- `{{EXISTING_SUMMARY}}` -- current summary text
- `{{DELTA_MEMORIES}}` -- JSON of added/updated memories only
- `{{DELTA_TYPE}}` -- "additions", "updates", or "additions_and_updates"
- `{{CLAUDE_MD}}` -- concatenated CLAUDE.md chain
- `{{TOKEN_BUDGET}}` -- target token count for the output

Instructions:
- Incorporate the delta memories into the existing summary
- Keep the summary within the token budget (may need to compress older content)
- Maintain inline memory ID citations
- Do not repeat information already in CLAUDE.md


## New DB Functions

```typescript
// Get summary state for a project
getProjectSummaryState(projectId: number): {
    summary: string;
    summary_hash: string;
    summary_snapshot: string;
    summary_incremental_count: number;
}

// Update summary after regeneration
updateProjectSummary(
    projectId: number,
    summary: string,
    hash: string,
    snapshot: string,
    incrementalCount: number
): void
```


## New Worker Functions

```typescript
// Main entry point, called from poll loop
checkProjectSummaries(): Promise<void>

// Compute aggregate hash for a project's memories
// Queries all memories for the project (including _global), no limit
computeMemoryHash(projectId: number): string

// Compute per-memory content hashes
// Hash covers: content, tags, domain, category, importance
// Queries all memories for the project (including _global), no limit
computeMemorySnapshot(projectId: number): Record<number, string>

// Determine delta between current state and snapshot
computeSummaryDelta(
    current: Record<number, string>,
    snapshot: Record<number, string>
): { added: number[]; updated: number[]; deleted: number[] }

// Read CLAUDE.md chain for a project path
// Walks from ~/.claude/CLAUDE.md -> parent dirs up to git root -> project dir
// Returns empty string for _global or non-existent paths
loadClaudeMdChain(projectPath: string): string

// Generate or update summary
// On LLM failure: logs error, leaves existing summary unchanged, retries next cycle
generateSummary(projectId: number, mode: 'full' | 'incremental'): Promise<void>
```


## Files Modified

| File | Change |
|------|--------|
| `src/db.ts` | Schema migration (4 columns), `getProjectSummaryState()`, `updateProjectSummary()` |
| `src/config.ts` | Add `summarySchema`, nest under `workerSchema` |
| `src/context.ts` | Modify `buildStartupContext()` to use summary when available |
| `src/worker.ts` | Add `checkProjectSummaries()`, `generateSummary()`, hash/delta utilities, CLAUDE.md loader |
| `src/prompts/summarize-full.md` | New prompt template |
| `src/prompts/summarize-incremental.md` | New prompt template |
| `test/api.test.ts` | Tests for new DB functions and summary logic |


## Error Handling

- **LLM call fails** (network error, timeout, Agent SDK error): Log the error, leave existing summary unchanged, retry on next cycle. Follows the same pattern as existing `synthesizeMemories()` and `cleanupWithLLM()`.
- **LLM returns malformed output** (no valid summary text, garbled response): Treat as a failure -- log and retry next cycle. Do not store partial/bad summaries.
- **LLM output exceeds token budget**: Store it anyway (the budget is a target, not a hard limit). The +200 tolerance absorbs minor overruns. If significantly over, the next full regen cycle will correct it.


## Edge Cases

- **`_global` project**: Has no filesystem path, so CLAUDE.md chain is empty. Summary still works, just without deduplication.
- **`_global` memory changes**: Triggers hash change for every project that includes `_global` memories. Quiet period prevents thrashing.
- **Project path doesn't exist on disk**: CLAUDE.md loading fails gracefully (empty string).
- **Worker crashes mid-summary**: No partial state is written. The hash still differs, so the next check retries.
- **Memory deleted between hash check and summary generation**: The snapshot captures current state at generation time, so this is safe. Deletions also pass the quiet period check naturally (no surviving row has a recent timestamp, so the period appears satisfied).
- **Config changes to `memoryTokenBudget`**: Handled at two levels. (1) The aggregate hash is salted with the current `memoryTokenBudget`, so a budget change invalidates the hash and triggers regeneration after the quiet period. (2) `buildStartupContext()` checks if the stored summary exceeds `memoryTokenBudget + 200` tokens and falls back to deterministic until the worker regenerates with the new budget.
- **First poll fires immediately**: `pollCount` starts at 0, so `pollCount % summaryEvery === 0` is true on the first poll. This is intentional -- check for stale summaries on startup.
