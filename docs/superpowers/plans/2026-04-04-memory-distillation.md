# Memory Distillation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Periodically validate project memories against the current codebase state and soft-delete stale ones, with automatic purge after a grace period.

**Architecture:** Stop hook triggers eligibility check via the existing `/enqueue` handler. If thresholds are met, a `distillation_queue` entry is created. The background worker dequeues it, gathers a repo tree + git log signal bundle, then processes memories in domain-scoped batches via Haiku with read-only tool access (Read, Glob, Grep). Stale memories get `deleted_at` set and are excluded from all queries until hard-deleted after a configurable grace period.

**Tech Stack:** SQLite (better-sqlite3), Zod config, Hono HTTP, @anthropic-ai/claude-agent-sdk (Haiku), Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-memory-distillation-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/config.ts` | New `distillation` Zod schema section with 4 settings |
| `src/db.ts` | Migrations (3 columns, 1 table, 1 index), queue helpers, soft-delete queries, counter increment, purge function |
| `src/distillation.ts` | **New file.** Signal gathering (tree + git log), domain batching, LLM calls, orchestration |
| `src/prompts/distill-memories.md` | **New file.** LLM prompt template |
| `src/worker.ts` | Import and call `processDistillationQueue()` in the tick loop |
| `src/app.ts` | Call `checkDistillationEligibility()` after observation enqueue |
| `test/distillation.test.ts` | **New file.** Tests for config, migrations, queue, soft-delete, purge, eligibility |

---

### Task 1: Configuration — `distillation` settings

**Files:**
- Modify: `src/config.ts:1-71`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/config.test.ts`:

```typescript
describe('distillation config', () => {
    it('provides defaults when no distillation section exists', () => {
        const config = loadConfig('/nonexistent/path/config.yaml');
        expect(config.distillation).toEqual({
            minAgeHours: 24,
            minMemoriesSince: 5,
            batchSize: 50,
            purgeAfterHours: 168,
        });
    });

    it('allows overriding distillation settings', () => {
        const tmpConfig = join(TMP_DIR, `distillation-cfg-${Date.now()}.yaml`);
        writeFileSync(tmpConfig, stringify({
            distillation: { minAgeHours: 48, minMemoriesSince: 10 },
        }));
        try {
            const config = loadConfig(tmpConfig);
            expect(config.distillation.minAgeHours).toBe(48);
            expect(config.distillation.minMemoriesSince).toBe(10);
            expect(config.distillation.batchSize).toBe(50); // default preserved
            expect(config.distillation.purgeAfterHours).toBe(168); // default preserved
        } finally {
            unlinkSync(tmpConfig);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ai-memory && pnpm vitest run test/config.test.ts`
Expected: FAIL — `config.distillation` is undefined

- [ ] **Step 3: Implement the distillation config schema**

In `src/config.ts`, add the schema after `projectsSchema` (around line 62):

```typescript
const distillationSchema = z.object({
    minAgeHours: z.number().min(1).default(24),
    minMemoriesSince: z.number().min(1).default(5),
    batchSize: z.number().min(1).default(50),
    purgeAfterHours: z.number().min(1).default(168),
});
```

Add `distillation` to `configSchema`:

```typescript
export const configSchema = z.object({
    worker: workerSchema.default({}),
    context: contextSchema.default({}),
    architecture: architectureSchema.default({}),
    server: serverSchema.default({}),
    api: apiSchema.default({}),
    projects: projectsSchema.default({}),
    distillation: distillationSchema.default({}),
});
```

Add to `applyDefaults()`:

```typescript
const distillation = distillationSchema.parse(raw.distillation ?? {});
return { worker, context, architecture, server, api, projects, distillation };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ai-memory && pnpm vitest run test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(distillation): add config schema with defaults"
```

---

### Task 2: Database migrations — new columns and table

**Files:**
- Modify: `src/db.ts:240-262` (migration section)
- Test: `test/distillation.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `test/distillation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initDb, closeDb, getDb, getOrCreateProject, insertMemory } from '../src/db.js';

const TMP_DIR = join(import.meta.dirname, '.');
let dbPath: string;

function cleanupDb(p: string) {
    for (const suffix of ['', '-wal', '-shm']) {
        const f = p + suffix;
        if (existsSync(f)) unlinkSync(f);
    }
}

beforeEach(() => {
    dbPath = join(TMP_DIR, `test-distill-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDb(dbPath);
});

afterEach(() => {
    closeDb();
    cleanupDb(dbPath);
});

describe('distillation migrations', () => {
    it('projects table has distillation columns', () => {
        const db = getDb();
        const cols = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
        const colNames: Record<string, true> = {};
        for (const c of cols) colNames[c.name] = true;

        expect(colNames['distillation_at']).toBe(true);
        expect(colNames['distillation_memories_since']).toBe(true);
    });

    it('memories table has deleted_at and deleted_reason columns', () => {
        const db = getDb();
        const cols = db.prepare("PRAGMA table_info('memories')").all() as { name: string }[];
        const colNames: Record<string, true> = {};
        for (const c of cols) colNames[c.name] = true;

        expect(colNames['deleted_at']).toBe(true);
        expect(colNames['deleted_reason']).toBe(true);
    });

    it('distillation_queue table exists', () => {
        const db = getDb();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='distillation_queue'").all();
        expect(tables.length).toBe(1);
    });

    it('new memories have empty deleted_at by default', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'test memory', 'tag1', 'fact', 3, '', 'general');
        const db = getDb();
        const row = db.prepare('SELECT deleted_at, deleted_reason FROM memories WHERE id = ?').get(id) as any;
        expect(row.deleted_at).toBe('');
        expect(row.deleted_reason).toBe('');
    });

    it('new projects have distillation defaults', () => {
        const project = getOrCreateProject('/test/distill');
        const db = getDb();
        const row = db.prepare('SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_at).toBe('');
        expect(row.distillation_memories_since).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ai-memory && pnpm vitest run test/distillation.test.ts`
Expected: FAIL — columns don't exist

- [ ] **Step 3: Add migrations to `initSchema()`**

In `src/db.ts`, after the `consolidate` migration (around line 242), add:

```typescript
    // Migration: distillation columns on projects
    if (!projectColNames['distillation_at']) {
        db.exec("ALTER TABLE projects ADD COLUMN distillation_at TEXT NOT NULL DEFAULT ''");
    }
    if (!projectColNames['distillation_memories_since']) {
        db.exec("ALTER TABLE projects ADD COLUMN distillation_memories_since INTEGER NOT NULL DEFAULT 0");
    }

    // Migration: soft-delete columns on memories
    const memoryCols = db.prepare("PRAGMA table_info('memories')").all() as { name: string }[];
    const memoryColNames: Record<string, true> = {};
    for (const c of memoryCols) memoryColNames[c.name] = true;

    if (!memoryColNames['deleted_at']) {
        db.exec("ALTER TABLE memories ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
    }
    if (!memoryColNames['deleted_reason']) {
        db.exec("ALTER TABLE memories ADD COLUMN deleted_reason TEXT NOT NULL DEFAULT ''");
    }
```

In the main `CREATE TABLE IF NOT EXISTS` block in `initSchema()`, add the `distillation_queue` table after `memory_queue`:

```sql
CREATE TABLE IF NOT EXISTS distillation_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

And add the index in the `CREATE INDEX` section:

```sql
CREATE INDEX IF NOT EXISTS idx_distillation_queue_status ON distillation_queue(status);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ai-memory && pnpm vitest run test/distillation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.ts test/distillation.test.ts
git commit -m "feat(distillation): add db migrations for soft-delete and queue"
```

---

### Task 3: Queue helpers and soft-delete functions in `db.ts`

**Files:**
- Modify: `src/db.ts` (add functions after the memory_queue helpers, around line 981)
- Test: `test/distillation.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/distillation.test.ts`:

```typescript
import {
    initDb, closeDb, getDb, getOrCreateProject, insertMemory,
    enqueueDistillation, dequeueDistillation, completeDistillationQueue,
    checkDistillationEligibility, softDeleteMemory, purgeDeletedMemories,
    listMemories, searchMemories, searchMemoriesFuzzy,
    incrementDistillationMemoryCount, resetDistillationState,
} from '../src/db.js';

describe('distillation queue', () => {
    it('enqueue, dequeue, complete lifecycle', () => {
        const project = getOrCreateProject('/test/distill');
        const id = enqueueDistillation(project.id);
        expect(id).toBeGreaterThan(0);

        const item = dequeueDistillation();
        expect(item).not.toBeNull();
        expect(item!.project_id).toBe(project.id);

        completeDistillationQueue(item!.id, 'done');
        const next = dequeueDistillation();
        expect(next).toBeNull();
    });

    it('does not enqueue duplicate pending entries for same project', () => {
        const project = getOrCreateProject('/test/distill');
        enqueueDistillation(project.id);
        enqueueDistillation(project.id); // should be a no-op or handled
        const db = getDb();
        const count = (db.prepare(
            "SELECT COUNT(*) as c FROM distillation_queue WHERE project_id = ? AND status = 'pending'"
        ).get(project.id) as any).c;
        expect(count).toBe(1);
    });
});

describe('soft-delete', () => {
    it('softDeleteMemory sets deleted_at and deleted_reason', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'stale memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(id, 'file no longer exists');
        const db = getDb();
        const row = db.prepare('SELECT deleted_at, deleted_reason FROM memories WHERE id = ?').get(id) as any;
        expect(row.deleted_at).not.toBe('');
        expect(row.deleted_reason).toBe('file no longer exists');
    });

    it('listMemories excludes soft-deleted memories', () => {
        const project = getOrCreateProject('/test/distill');
        insertMemory(project.id, 'active memory', '', 'fact', 3, '', 'general');
        const deletedId = insertMemory(project.id, 'stale memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(deletedId, 'outdated');

        const memories = listMemories('/test/distill');
        expect(memories.length).toBe(1);
        expect(memories[0].content).toBe('active memory');
    });

    it('searchMemories excludes soft-deleted memories', () => {
        const project = getOrCreateProject('/test/distill');
        insertMemory(project.id, 'findable memory about react', 'react', 'fact', 3, '', 'frontend');
        const deletedId = insertMemory(project.id, 'deleted memory about react', 'react', 'fact', 3, '', 'frontend');
        softDeleteMemory(deletedId, 'outdated');

        const results = searchMemories('react', '/test/distill');
        expect(results.length).toBe(1);
        expect(results[0].content).toBe('findable memory about react');
    });

    it('searchMemoriesFuzzy excludes soft-deleted memories', () => {
        const project = getOrCreateProject('/test/distill');
        insertMemory(project.id, 'findable memory about zustand', 'zustand', 'fact', 3, '', 'frontend');
        const deletedId = insertMemory(project.id, 'deleted memory about zustand', 'zustand', 'fact', 3, '', 'frontend');
        softDeleteMemory(deletedId, 'outdated');

        const results = searchMemoriesFuzzy('zustand', '/test/distill');
        expect(results.length).toBe(1);
        expect(results[0].content).toBe('findable memory about zustand');
    });
});

describe('purge', () => {
    it('purgeDeletedMemories removes memories past grace period', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'old deleted memory', '', 'fact', 3, '', 'general');

        // Set deleted_at to 8 days ago (past default 168h grace period)
        const db = getDb();
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        db.prepare('UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?')
            .run(eightDaysAgo, 'test reason', id);

        const purged = purgeDeletedMemories();
        expect(purged).toBe(1);

        const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
        expect(row).toBeUndefined();
    });

    it('purgeDeletedMemories does not remove memories within grace period', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'recently deleted memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(id, 'maybe stale');

        const purged = purgeDeletedMemories();
        expect(purged).toBe(0);

        const db = getDb();
        const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
        expect(row).toBeDefined();
    });
});

describe('distillation counter', () => {
    it('incrementDistillationMemoryCount bumps the counter', () => {
        const project = getOrCreateProject('/test/distill');
        incrementDistillationMemoryCount(project.id);
        incrementDistillationMemoryCount(project.id);

        const db = getDb();
        const row = db.prepare('SELECT distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(2);
    });

    it('resetDistillationState resets counter and sets timestamp', () => {
        const project = getOrCreateProject('/test/distill');
        incrementDistillationMemoryCount(project.id);
        incrementDistillationMemoryCount(project.id);

        resetDistillationState(project.id);

        const db = getDb();
        const row = db.prepare('SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(0);
        expect(row.distillation_at).not.toBe('');
    });
});

describe('checkDistillationEligibility', () => {
    it('returns false when counter is below threshold', () => {
        const project = getOrCreateProject('/test/distill');
        // Counter is 0, threshold is 5
        expect(checkDistillationEligibility(project.id)).toBe(false);
    });

    it('returns true when counter meets threshold and enough time has passed', () => {
        const project = getOrCreateProject('/test/distill');
        const db = getDb();
        // Set counter above threshold
        db.prepare('UPDATE projects SET distillation_memories_since = 10 WHERE id = ?').run(project.id);
        // distillation_at is '' (never ran) — should be eligible
        expect(checkDistillationEligibility(project.id)).toBe(true);
    });

    it('returns false when distillation ran recently', () => {
        const project = getOrCreateProject('/test/distill');
        const db = getDb();
        db.prepare('UPDATE projects SET distillation_memories_since = 10, distillation_at = ? WHERE id = ?')
            .run(new Date().toISOString(), project.id);
        // Distilled just now — not enough time has passed
        expect(checkDistillationEligibility(project.id)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ai-memory && pnpm vitest run test/distillation.test.ts`
Expected: FAIL — functions don't exist

- [ ] **Step 3: Implement queue helpers and soft-delete functions**

Add to `src/db.ts` after the `completeMemoryQueue` function (around line 981):

```typescript
// ── Distillation queue ─────────────────────────────────────────

export function enqueueDistillation(projectId: number): number {
    const db = getDb();
    // Skip if already pending
    const existing = db.prepare(
        "SELECT id FROM distillation_queue WHERE project_id = ? AND status = 'pending'"
    ).get(projectId) as any;
    if (existing) return existing.id;

    const result = db.prepare('INSERT INTO distillation_queue (project_id) VALUES (?)').run(projectId);
    return Number(result.lastInsertRowid);
}

export function dequeueDistillation(): { id: number; project_id: number } | null {
    const db = getDb();
    const row = db.prepare(
        "SELECT id, project_id FROM distillation_queue WHERE status = 'pending' ORDER BY id LIMIT 1"
    ).get() as any;
    if (!row) return null;
    db.prepare("UPDATE distillation_queue SET status = 'processing' WHERE id = ?").run(row.id);
    return row;
}

export function completeDistillationQueue(id: number, status: 'done' | 'failed'): void {
    const db = getDb();
    db.prepare('UPDATE distillation_queue SET status = ? WHERE id = ?').run(status, id);
}

// ── Soft-delete ────────────────────────────────────────────────

export function softDeleteMemory(id: number, reason: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?').run(now, reason, id);
}

export function purgeDeletedMemories(): number {
    const db = getDb();
    const hours = getConfig().distillation.purgeAfterHours;
    const result = db.prepare(
        `DELETE FROM memories WHERE deleted_at != '' AND deleted_at < datetime('now', '-${hours} hours')`
    ).run();
    return result.changes;
}

// ── Distillation state ─────────────────────────────────────────

export function incrementDistillationMemoryCount(projectId: number): void {
    const db = getDb();
    db.prepare('UPDATE projects SET distillation_memories_since = distillation_memories_since + 1 WHERE id = ?')
        .run(projectId);
}

export function resetDistillationState(projectId: number): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE projects SET distillation_at = ?, distillation_memories_since = 0 WHERE id = ?')
        .run(now, projectId);
}

export function checkDistillationEligibility(projectId: number): boolean {
    const db = getDb();
    const row = db.prepare(
        'SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?'
    ).get(projectId) as { distillation_at: string; distillation_memories_since: number } | undefined;
    if (!row) return false;

    const cfg = getConfig().distillation;

    // Check memory count threshold
    if (row.distillation_memories_since < cfg.minMemoriesSince) return false;

    // Check time threshold
    if (row.distillation_at) {
        const lastRun = Date.parse(row.distillation_at);
        if (!Number.isNaN(lastRun)) {
            const hoursSince = (Date.now() - lastRun) / 3600000;
            if (hoursSince < cfg.minAgeHours) return false;
        }
    }

    return true;
}

export function getDistillationState(projectId: number): { distillation_at: string; git_root: string } {
    const db = getDb();
    const row = db.prepare(
        'SELECT distillation_at, git_root FROM projects WHERE id = ?'
    ).get(projectId) as any;
    return { distillation_at: row?.distillation_at ?? '', git_root: row?.git_root ?? '' };
}

export function listActiveMemoriesByDomain(projectId: number): Record<string, { id: number; content: string; category: string; created_at: string }[]> {
    const db = getDb();
    const rows = db.prepare(
        `SELECT id, content, category, domain, created_at FROM memories
         WHERE project_id = ? AND deleted_at = ''
         ORDER BY domain, importance DESC`
    ).all(projectId) as { id: number; content: string; category: string; domain: string; created_at: string }[];

    const grouped: Record<string, { id: number; content: string; category: string; created_at: string }[]> = {};
    for (const row of rows) {
        const domain = row.domain || 'general';
        if (!grouped[domain]) grouped[domain] = [];
        grouped[domain].push({ id: row.id, content: row.content, category: row.category, created_at: row.created_at });
    }
    return grouped;
}
```

- [ ] **Step 4: Add `deleted_at = ''` filter to existing query functions**

In `listMemories()` (line 676), add the filter to the conditions array at the start of the function:

```typescript
const conditions: string[] = ["m.deleted_at = ''"];
```

In `searchMemories()` (line 557), add after the `WHERE memories_fts MATCH ?` line:

```typescript
sql += " AND m.deleted_at = ''";
```

In `searchMemoriesFuzzy()` (line 616), add after the `WHERE memories_trigram MATCH ?` line:

```typescript
sql += " AND m.deleted_at = ''";
```

- [ ] **Step 5: Wire `incrementDistillationMemoryCount` into `insertMemory()`**

In `insertMemory()` (line 498), after the `db.prepare(...).run(...)` call (line 525), add:

```typescript
    // Bump distillation counter
    incrementDistillationMemoryCount(projectId);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ai-memory && pnpm vitest run test/distillation.test.ts`
Expected: PASS

Also run existing tests to confirm no regressions:

Run: `cd ai-memory && pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/db.ts test/distillation.test.ts
git commit -m "feat(distillation): add queue helpers, soft-delete, eligibility check"
```

---

### Task 4: Prompt template

**Files:**
- Create: `src/prompts/distill-memories.md`

- [ ] **Step 1: Create the prompt file**

Create `src/prompts/distill-memories.md`:

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

- [ ] **Step 2: Commit**

```bash
git add src/prompts/distill-memories.md
git commit -m "feat(distillation): add LLM prompt template"
```

---

### Task 5: Distillation orchestrator — `src/distillation.ts`

**Files:**
- Create: `src/distillation.ts`
- Modify: `src/worker.ts:167-205` (add call to tick loop)

- [ ] **Step 1: Create `src/distillation.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    dequeueDistillation,
    completeDistillationQueue,
    listActiveMemoriesByDomain,
    softDeleteMemory,
    resetDistillationState,
    getDistillationState,
    getProjectPathById,
} from './db.js';
import { getConfig } from './config.js';
import { log, error as logError } from './logger.js';
import { broadcast } from './sse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

function loadPrompt(name: string, vars: Record<string, string> = {}): string {
    let text = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8');
    for (const [key, value] of Object.entries(vars)) {
        text = text.replaceAll(`{{${key}}}`, value);
    }
    return text;
}

function gatherRepoTree(projectPath: string): string {
    try {
        return execSync(
            "tree -L 4 --dirsfirst -I 'node_modules|.git|dist|build|coverage|.next|__pycache__'",
            { cwd: projectPath, encoding: 'utf-8', timeout: 10000 },
        ).slice(0, 8000); // cap output size
    } catch {
        return '(tree command failed or not available)';
    }
}

function gatherGitLog(projectPath: string, sinceIso: string): string {
    try {
        const afterArg = sinceIso
            ? `--after="${sinceIso}"`
            : `--after="${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}"`;
        const output = execSync(
            `git log ${afterArg} --format="%h %s" --stat`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 10000 },
        );
        return output.slice(0, 12000) || '(no commits since last review)';
    } catch {
        return '(git log failed)';
    }
}

async function distillBatch(
    memories: { id: number; content: string; category: string; created_at: string }[],
    domain: string,
    tree: string,
    gitLog: string,
    projectPath: string,
): Promise<{ id: number; reason: string }[]> {
    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const memoriesJson = JSON.stringify(
            memories.map(m => ({ id: m.id, content: m.content, category: m.category, created_at: m.created_at })),
            null,
            2,
        );

        const prompt = loadPrompt('distill-memories', {
            TREE: tree,
            GIT_LOG: gitLog,
            DOMAIN: domain,
            MEMORIES: memoriesJson,
        });

        let result = '';
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

        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return [];

        const parsed = JSON.parse(jsonMatch[0]);
        return Array.isArray(parsed.delete) ? parsed.delete : [];
    } catch (err) {
        logError('distillation', `LLM batch failed for domain "${domain}": ${err}`);
        return [];
    }
}

export async function processDistillationQueue(): Promise<void> {
    const item = dequeueDistillation();
    if (!item) return;

    try {
        const projectPath = getProjectPathById(item.project_id);
        if (!projectPath || projectPath === '_global') {
            completeDistillationQueue(item.id, 'done');
            return;
        }

        const state = getDistillationState(item.project_id);
        const scanRoot = state.git_root || projectPath;

        log('distillation', `Starting distillation for project ${projectPath}`);

        // Gather signals once, reuse across batches
        const tree = gatherRepoTree(scanRoot);
        const gitLog = gatherGitLog(scanRoot, state.distillation_at);

        // If no commits since last distillation, skip entirely
        if (state.distillation_at && gitLog === '(no commits since last review)') {
            log('distillation', `No changes since last distillation, skipping`);
            resetDistillationState(item.project_id);
            completeDistillationQueue(item.id, 'done');
            return;
        }

        const memsByDomain = listActiveMemoriesByDomain(item.project_id);
        const batchSize = getConfig().distillation.batchSize;
        let totalDeleted = 0;

        for (const [domain, memories] of Object.entries(memsByDomain)) {
            // Process in batches
            for (let i = 0; i < memories.length; i += batchSize) {
                const batch = memories.slice(i, i + batchSize);
                const toDelete = await distillBatch(batch, domain, tree, gitLog, scanRoot);

                for (const entry of toDelete) {
                    // Validate the ID exists in this batch to prevent hallucinated IDs
                    const validId = batch.some(m => m.id === entry.id);
                    if (validId) {
                        softDeleteMemory(entry.id, entry.reason);
                        totalDeleted++;
                    }
                }
            }
        }

        resetDistillationState(item.project_id);
        completeDistillationQueue(item.id, 'done');

        if (totalDeleted > 0) {
            broadcast('counts:updated', {});
        }
        log('distillation', `Distillation complete for ${projectPath}: soft-deleted ${totalDeleted} memories`);
    } catch (err) {
        logError('distillation', `Distillation failed for queue item ${item.id}: ${err}`);
        completeDistillationQueue(item.id, 'failed');
    }
}
```

- [ ] **Step 2: Run build to verify no compile errors**

Run: `cd ai-memory && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/distillation.ts
git commit -m "feat(distillation): add orchestrator with signal gathering and LLM batching"
```

---

### Task 6: Wire into worker loop and enqueue handler

**Files:**
- Modify: `src/worker.ts:1-36` (imports), `src/worker.ts:167-205` (tick loop)
- Modify: `src/app.ts:89-98` (enqueue handler)

- [ ] **Step 1: Add distillation to worker tick loop**

In `src/worker.ts`, add the import at the top:

```typescript
import { processDistillationQueue } from './distillation.js';
```

In the worker tick (inside the `setInterval` callback, after the `checkGitConsolidation()` call around line 199), add:

```typescript
            await processDistillationQueue();
```

- [ ] **Step 2: Add purge to worker tick**

In `src/worker.ts`, add `purgeDeletedMemories` to the imports from `./db.js`:

```typescript
import {
    // ... existing imports ...
    purgeDeletedMemories,
} from './db.js';
```

In the worker tick, after the `purgeStaleObservations` block (around line 177), add:

```typescript
            const purgedMemories = purgeDeletedMemories();
            if (purgedMemories > 0) {
                log('worker', `Purged ${purgedMemories} soft-deleted memories past grace period`);
                broadcast('counts:updated', {});
            }
```

- [ ] **Step 3: Add eligibility check to `/enqueue` handler**

In `src/app.ts`, add `checkDistillationEligibility` and `enqueueDistillation` to the imports from `./db.js`:

```typescript
import {
    // ... existing imports ...
    checkDistillationEligibility,
    enqueueDistillation,
} from './db.js';
```

In the `/enqueue` handler (line 89-98), after the `enqueueObservation` call, add the eligibility check:

```typescript
    app.post('/enqueue', async (c) => {
        const body = await c.req.json();
        const projectPath = body.project || '_global';
        const isNew = !listProjects().some(p => p.path === projectPath);
        const project = getOrCreateProject(projectPath);
        const id = enqueueObservation(project.id, JSON.stringify(body.payload || body));
        log('api', `Enqueued turn for ${projectPath}`);
        if (isNew) broadcast('counts:updated', {});

        // Check if distillation should be triggered
        if (checkDistillationEligibility(project.id)) {
            enqueueDistillation(project.id);
            log('api', `Enqueued distillation for ${projectPath}`);
        }

        return c.json({ queued: true, id });
    });
```

- [ ] **Step 4: Run build to verify no compile errors**

Run: `cd ai-memory && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Run all tests to confirm no regressions**

Run: `cd ai-memory && pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts src/app.ts
git commit -m "feat(distillation): wire into worker loop and enqueue handler"
```

---

### Task 7: Integration test for the full flow

**Files:**
- Test: `test/distillation.test.ts` (add integration describe block)

- [ ] **Step 1: Add integration test**

Add to `test/distillation.test.ts`:

```typescript
import { enqueueObservation, enqueueDistillation, dequeueDistillation, completeDistillationQueue } from '../src/db.js';

describe('distillation integration', () => {
    it('insertMemory increments distillation counter', () => {
        const project = getOrCreateProject('/test/distill-int');
        insertMemory(project.id, 'memory 1', '', 'fact', 3, '', 'general');
        insertMemory(project.id, 'memory 2', '', 'fact', 3, '', 'general');

        const db = getDb();
        const row = db.prepare('SELECT distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(2);
    });

    it('full queue lifecycle: enqueue → dequeue → process → complete', () => {
        const project = getOrCreateProject('/test/distill-lifecycle');
        // Add enough memories to cross the threshold
        for (let i = 0; i < 6; i++) {
            insertMemory(project.id, `memory ${i}`, '', 'fact', 3, '', 'general');
        }

        // Should be eligible now (6 >= 5 memories, never distilled)
        expect(checkDistillationEligibility(project.id)).toBe(true);

        // Enqueue
        const queueId = enqueueDistillation(project.id);
        expect(queueId).toBeGreaterThan(0);

        // Dequeue
        const item = dequeueDistillation();
        expect(item).not.toBeNull();
        expect(item!.project_id).toBe(project.id);

        // Complete
        completeDistillationQueue(item!.id, 'done');

        // Reset state
        resetDistillationState(project.id);
        const db = getDb();
        const row = db.prepare('SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(0);
        expect(row.distillation_at).not.toBe('');
    });
});
```

- [ ] **Step 2: Run tests**

Run: `cd ai-memory && pnpm vitest run test/distillation.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd ai-memory && pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add test/distillation.test.ts
git commit -m "test(distillation): add integration tests for full queue lifecycle"
```

---

### Task 8: Export new functions and verify build

**Files:**
- Verify: `src/db.ts` exports
- Verify: Full build + test

- [ ] **Step 1: Verify all new db.ts functions are exported**

Check that these functions are exported from `src/db.ts`:
- `enqueueDistillation`
- `dequeueDistillation`
- `completeDistillationQueue`
- `softDeleteMemory`
- `purgeDeletedMemories`
- `incrementDistillationMemoryCount`
- `resetDistillationState`
- `checkDistillationEligibility`
- `getDistillationState`
- `listActiveMemoriesByDomain`

- [ ] **Step 2: Full build**

Run: `cd ai-memory && pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Full test suite**

Run: `cd ai-memory && pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "fix(distillation): fixups from integration verification"
```

Skip this commit if no changes were needed.
