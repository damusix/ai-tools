# Summary-Based Context Injection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dynamic memory formatting in context injection with pre-computed LLM-generated prose summaries, cached per project and regenerated incrementally when memories change.

**Architecture:** A new `src/summary.ts` module handles all summary logic (hashing, delta detection, CLAUDE.md loading, LLM generation). The existing worker poll loop triggers summary checks at a configurable interval. `buildStartupContext()` branches between the deterministic formatter (small projects) and the cached summary (large projects).

**Tech Stack:** TypeScript, better-sqlite3, Node crypto (SHA-256), Claude Agent SDK (Haiku), Zod config validation

**Spec:** `docs/superpowers/specs/2026-03-15-summary-based-context-injection-design.md`

---

## Chunk 1: Foundation (Config, Schema, Pure Utilities)

### Task 1: Add summary config schema

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/config.test.ts`:

```typescript
it('summary config has correct defaults', () => {
    const config = loadConfig(join(TEST_DIR, 'nonexistent.yaml'));
    expect(config.worker.summary.quietPeriodMs).toBe(300000);
    expect(config.worker.summary.maxIncrementalCycles).toBe(10);
    expect(config.worker.summary.checkIntervalMs).toBe(60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/config.test.ts`
Expected: FAIL — `config.worker.summary` is undefined

- [ ] **Step 3: Implement the config schema**

In `src/config.ts`, add the summary schema and nest it under `workerSchema`:

```typescript
const summarySchema = z.object({
    quietPeriodMs: z.number().min(60000).default(300000),
    maxIncrementalCycles: z.number().min(1).default(10),
    checkIntervalMs: z.number().min(10000).default(60000),
});
```

Add `summary: summarySchema.default({})` to `workerSchema`.

Update `applyDefaults()` to handle the nested `summary` section — parse it the same way other sections are parsed. If `raw.worker` exists and has a `summary` key, pass it through; otherwise it falls back to defaults via `.default({})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/config.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
git add src/config.ts test/config.test.ts
git commit -m "feat: add summary config schema with defaults"
```

---

### Task 2: Add schema migration and DB query functions

**Files:**
- Modify: `src/db.ts`
- Test: `test/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/db.test.ts`:

```typescript
import {
    // ... existing imports ...
    getProjectSummaryState,
    updateProjectSummary,
    getMemoriesForHashing,
} from '../src/db.js';

describe('project summary state', () => {
    it('getProjectSummaryState returns defaults for new project', () => {
        const proj = getOrCreateProject('/test/summary');
        const state = getProjectSummaryState(proj.id);
        expect(state.summary).toBe('');
        expect(state.summary_hash).toBe('');
        expect(state.summary_snapshot).toBe('');
        expect(state.summary_incremental_count).toBe(0);
    });

    it('updateProjectSummary stores and retrieves state', () => {
        const proj = getOrCreateProject('/test/summary2');
        const snapshot = JSON.stringify({ 1: 'abc', 2: 'def' });
        updateProjectSummary(proj.id, 'Test summary text', 'hash123', snapshot, 3);

        const state = getProjectSummaryState(proj.id);
        expect(state.summary).toBe('Test summary text');
        expect(state.summary_hash).toBe('hash123');
        expect(state.summary_snapshot).toBe(snapshot);
        expect(state.summary_incremental_count).toBe(3);
    });

    it('updateProjectSummary overwrites previous state', () => {
        const proj = getOrCreateProject('/test/summary3');
        updateProjectSummary(proj.id, 'old', 'h1', '{}', 5);
        updateProjectSummary(proj.id, 'new', 'h2', '{"3":"x"}', 0);

        const state = getProjectSummaryState(proj.id);
        expect(state.summary).toBe('new');
        expect(state.summary_hash).toBe('h2');
        expect(state.summary_incremental_count).toBe(0);
    });
});

describe('getMemoriesForHashing', () => {
    it('returns all memories for a project ordered by id', () => {
        const proj = getOrCreateProject('/test/hash');
        insertMemory(proj.id, 'mem1', 'tag1', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'mem2', 'tag2', 'decision', 5, '', 'backend');

        const mems = getMemoriesForHashing(proj.id);
        expect(mems.length).toBe(2);
        expect(mems[0].id).toBeLessThan(mems[1].id);
        expect(mems[0]).toHaveProperty('content');
        expect(mems[0]).toHaveProperty('tags');
        expect(mems[0]).toHaveProperty('domain');
        expect(mems[0]).toHaveProperty('category');
        expect(mems[0]).toHaveProperty('importance');
    });

    it('includes _global memories when querying a specific project', () => {
        const proj = getOrCreateProject('/test/hash-global');
        const global = getOrCreateProject('_global');
        insertMemory(proj.id, 'proj mem', '', 'fact', 3, '', 'frontend');
        insertMemory(global.id, 'global mem', '', 'fact', 3, '', 'general');

        const mems = getMemoriesForHashing(proj.id);
        expect(mems.length).toBe(2);
    });

    it('returns only _global memories for _global project', () => {
        const proj = getOrCreateProject('/test/hash-global2');
        const global = getOrCreateProject('_global');
        insertMemory(proj.id, 'proj mem', '', 'fact', 3, '');
        insertMemory(global.id, 'global mem', '', 'fact', 3, '');

        const globalMems = getMemoriesForHashing(global.id);
        expect(globalMems.length).toBe(1);
        expect(globalMems[0].content).toBe('global mem');
    });

    it('returns memories with no limit', () => {
        const proj = getOrCreateProject('/test/hash-nolimit');
        for (let i = 0; i < 60; i++) {
            insertMemory(proj.id, `mem ${i}`, '', 'fact', 3, '');
        }
        const mems = getMemoriesForHashing(proj.id);
        expect(mems.length).toBe(60);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/db.test.ts`
Expected: FAIL — functions don't exist yet

- [ ] **Step 3: Add the schema migration**

In `src/db.ts`, add after the existing `initSchema()` migrations (after the trigram backfill and seeding blocks), using the `PRAGMA table_info` pattern for idempotency:

```typescript
// Migration: add summary columns to projects
const projectCols = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
const projectColNames: Record<string, true> = {};
for (const c of projectCols) projectColNames[c.name] = true;

if (!projectColNames['summary']) {
    db.exec("ALTER TABLE projects ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
}
if (!projectColNames['summary_hash']) {
    db.exec("ALTER TABLE projects ADD COLUMN summary_hash TEXT NOT NULL DEFAULT ''");
}
if (!projectColNames['summary_snapshot']) {
    db.exec("ALTER TABLE projects ADD COLUMN summary_snapshot TEXT NOT NULL DEFAULT ''");
}
if (!projectColNames['summary_incremental_count']) {
    db.exec("ALTER TABLE projects ADD COLUMN summary_incremental_count INTEGER NOT NULL DEFAULT 0");
}
```

- [ ] **Step 4: Add the query functions**

In `src/db.ts`, add:

```typescript
export function getProjectSummaryState(projectId: number): {
    summary: string;
    summary_hash: string;
    summary_snapshot: string;
    summary_incremental_count: number;
} {
    const db = getDb();
    return db.prepare(
        'SELECT summary, summary_hash, summary_snapshot, summary_incremental_count FROM projects WHERE id = ?'
    ).get(projectId) as any;
}

export function updateProjectSummary(
    projectId: number,
    summary: string,
    hash: string,
    snapshot: string,
    incrementalCount: number,
): void {
    const db = getDb();
    db.prepare(
        'UPDATE projects SET summary = ?, summary_hash = ?, summary_snapshot = ?, summary_incremental_count = ? WHERE id = ?'
    ).run(summary, hash, snapshot, incrementalCount, projectId);
}

export function getMemoriesForHashing(projectId: number): {
    id: number; content: string; tags: string; domain: string | null;
    category: string; importance: number; created_at: string; updated_at: string;
}[] {
    const db = getDb();
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return [];

    let sql: string;
    const params: any[] = [];

    if (project.path === '_global') {
        sql = `
            SELECT m.id, m.content, m.tags, m.domain, m.category, m.importance,
                   m.created_at, m.updated_at
            FROM memories m
            JOIN projects p ON m.project_id = p.id
            WHERE p.path = '_global'
            ORDER BY m.id
        `;
    } else {
        sql = `
            SELECT m.id, m.content, m.tags, m.domain, m.category, m.importance,
                   m.created_at, m.updated_at
            FROM memories m
            JOIN projects p ON m.project_id = p.id
            WHERE p.path = ? OR p.path = '_global'
            ORDER BY m.id
        `;
        params.push(project.path);
    }

    return db.prepare(sql).all(...params) as any[];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/db.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```
git add src/db.ts test/db.test.ts
git commit -m "feat: add summary columns and query functions"
```

---

### Task 3: Hash and delta utility functions

**Files:**
- Create: `src/summary.ts`
- Create: `test/summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/summary.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getOrCreateProject, insertMemory, getDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import {
    computeMemoryHash,
    computeMemorySnapshot,
    computeSummaryDelta,
} from '../src/summary.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

let TEST_DIR: string;
let TEST_DB: string;

beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'ai-memory-summary-'));
    TEST_DB = join(TEST_DIR, 'test.db');
    initDb(TEST_DB);
    // Ensure config is loaded with defaults (hermetic — no real config file dependency)
    loadConfig(join(TEST_DIR, 'nonexistent.yaml'));
});

afterEach(() => {
    closeDb();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('computeMemoryHash', () => {
    it('returns a hex string', () => {
        const proj = getOrCreateProject('/test/hash');
        insertMemory(proj.id, 'test', '', 'fact', 3, '');
        const hash = computeMemoryHash(proj.id);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns same hash for same data', () => {
        const proj = getOrCreateProject('/test/hash-stable');
        insertMemory(proj.id, 'test', 'tag', 'fact', 3, '', 'frontend');
        const h1 = computeMemoryHash(proj.id);
        const h2 = computeMemoryHash(proj.id);
        expect(h1).toBe(h2);
    });

    it('returns different hash when memory content changes', () => {
        const proj = getOrCreateProject('/test/hash-diff');
        const id = insertMemory(proj.id, 'original', '', 'fact', 3, '');
        const h1 = computeMemoryHash(proj.id);

        const db = getDb();
        db.prepare("UPDATE memories SET content = 'modified' WHERE id = ?").run(id);
        const h2 = computeMemoryHash(proj.id);
        expect(h1).not.toBe(h2);
    });

    it('returns different hash when importance changes', () => {
        const proj = getOrCreateProject('/test/hash-imp');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '');
        const h1 = computeMemoryHash(proj.id);

        const db = getDb();
        db.prepare('UPDATE memories SET importance = 5 WHERE id = ?').run(id);
        const h2 = computeMemoryHash(proj.id);
        expect(h1).not.toBe(h2);
    });

    it('returns empty hash for project with no memories', () => {
        const proj = getOrCreateProject('/test/hash-empty');
        const hash = computeMemoryHash(proj.id);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('computeMemorySnapshot', () => {
    it('returns map of id to hash', () => {
        const proj = getOrCreateProject('/test/snap');
        const id1 = insertMemory(proj.id, 'mem1', 'tag', 'fact', 3, '', 'frontend');
        const id2 = insertMemory(proj.id, 'mem2', '', 'decision', 5, '', 'backend');

        const snap = computeMemorySnapshot(proj.id);
        expect(Object.keys(snap).length).toBe(2);
        expect(snap[id1]).toMatch(/^[a-f0-9]{64}$/);
        expect(snap[id2]).toMatch(/^[a-f0-9]{64}$/);
        expect(snap[id1]).not.toBe(snap[id2]);
    });
});

describe('computeSummaryDelta', () => {
    it('detects additions', () => {
        const current = { 1: 'aaa', 2: 'bbb', 3: 'ccc' };
        const snapshot = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([3]);
        expect(delta.updated).toEqual([]);
        expect(delta.deleted).toEqual([]);
    });

    it('detects deletions', () => {
        const current = { 1: 'aaa' };
        const snapshot = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([]);
        expect(delta.updated).toEqual([]);
        expect(delta.deleted).toEqual([2]);
    });

    it('detects updates', () => {
        const current = { 1: 'aaa', 2: 'changed' };
        const snapshot = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([]);
        expect(delta.updated).toEqual([2]);
        expect(delta.deleted).toEqual([]);
    });

    it('detects mixed changes', () => {
        const current = { 1: 'aaa', 2: 'changed', 4: 'new' };
        const snapshot = { 1: 'aaa', 2: 'bbb', 3: 'ccc' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([4]);
        expect(delta.updated).toEqual([2]);
        expect(delta.deleted).toEqual([3]);
    });

    it('returns empty delta when nothing changed', () => {
        const state = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(state, state);
        expect(delta.added).toEqual([]);
        expect(delta.updated).toEqual([]);
        expect(delta.deleted).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/summary.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement hash and delta functions**

Create `src/summary.ts`:

```typescript
import { createHash } from 'node:crypto';
import { getMemoriesForHashing } from './db.js';
import { getConfig } from './config.js';

type MemoryRow = {
    id: number; content: string; tags: string; domain: string | null;
    category: string; importance: number; created_at: string; updated_at: string;
};

function hashString(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function hashMemoryFields(m: MemoryRow): string {
    return hashString(`${m.content}\0${m.tags}\0${m.domain ?? ''}\0${m.category}\0${m.importance}`);
}

export function computeMemoryHash(projectId: number): string {
    const memories = getMemoriesForHashing(projectId);
    const budget = getConfig().context.memoryTokenBudget;
    const payload = memories.map(m => `${m.id}\0${hashMemoryFields(m)}`).join('\n');
    return hashString(`${budget}\0${payload}`);
}

export function computeMemorySnapshot(projectId: number): Record<number, string> {
    const memories = getMemoriesForHashing(projectId);
    const result: Record<number, string> = {};
    for (const m of memories) {
        result[m.id] = hashMemoryFields(m);
    }
    return result;
}

export function computeSummaryDelta(
    current: Record<number, string>,
    snapshot: Record<number, string>,
): { added: number[]; updated: number[]; deleted: number[] } {
    const added: number[] = [];
    const updated: number[] = [];
    const deleted: number[] = [];

    for (const idStr of Object.keys(current)) {
        const id = Number(idStr);
        if (!(id in snapshot)) {
            added.push(id);
        } else if (current[id] !== snapshot[id]) {
            updated.push(id);
        }
    }

    for (const idStr of Object.keys(snapshot)) {
        const id = Number(idStr);
        if (!(id in current)) {
            deleted.push(id);
        }
    }

    return { added, updated, deleted };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/summary.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
git add src/summary.ts test/summary.test.ts
git commit -m "feat: add hash and delta utilities for summary tracking"
```

---

### Task 4: CLAUDE.md chain loader

**Files:**
- Modify: `src/summary.ts`
- Modify: `test/summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/summary.test.ts`:

```typescript
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadClaudeMdChain } from '../src/summary.js';

describe('loadClaudeMdChain', () => {
    it('returns empty string for _global', () => {
        expect(loadClaudeMdChain('_global')).toBe('');
    });

    it('returns empty string for non-existent path', () => {
        expect(loadClaudeMdChain('/nonexistent/path/abc123')).toBe('');
    });

    it('reads CLAUDE.md from project directory', () => {
        const projDir = join(TEST_DIR, 'proj-claude');
        mkdirSync(projDir, { recursive: true });
        writeFileSync(join(projDir, 'CLAUDE.md'), '# Project Rules\nUse pnpm');

        const chain = loadClaudeMdChain(projDir);
        expect(chain).toContain('# Project Rules');
        expect(chain).toContain('Use pnpm');
    });

    it('walks up to git root collecting CLAUDE.md files', () => {
        const root = join(TEST_DIR, 'repo');
        const sub = join(root, 'packages', 'app');
        mkdirSync(sub, { recursive: true });
        mkdirSync(join(root, '.git')); // fake git root
        writeFileSync(join(root, 'CLAUDE.md'), 'root rules');
        writeFileSync(join(sub, 'CLAUDE.md'), 'app rules');

        const chain = loadClaudeMdChain(sub);
        expect(chain).toContain('root rules');
        expect(chain).toContain('app rules');
        // Root should come before sub
        expect(chain.indexOf('root rules')).toBeLessThan(chain.indexOf('app rules'));
    });

    it('stops walking at git root', () => {
        const outer = join(TEST_DIR, 'outer');
        const inner = join(outer, 'inner');
        mkdirSync(inner, { recursive: true });
        mkdirSync(join(inner, '.git'));
        writeFileSync(join(outer, 'CLAUDE.md'), 'outer rules');
        writeFileSync(join(inner, 'CLAUDE.md'), 'inner rules');

        const chain = loadClaudeMdChain(inner);
        expect(chain).toContain('inner rules');
        expect(chain).not.toContain('outer rules');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/summary.test.ts`
Expected: FAIL — `loadClaudeMdChain` not exported

- [ ] **Step 3: Implement loadClaudeMdChain**

Add to `src/summary.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, parse as parsePath } from 'node:path';
import { homedir } from 'node:os';

export function loadClaudeMdChain(projectPath: string): string {
    if (projectPath === '_global') return '';
    if (!existsSync(projectPath)) return '';

    const files: string[] = [];

    // 1. User's global CLAUDE.md
    const globalClaude = join(homedir(), '.claude', 'CLAUDE.md');
    if (existsSync(globalClaude)) {
        files.push(readFileSync(globalClaude, 'utf-8'));
    }

    // 2. Walk from project path up to git root, collecting CLAUDE.md files
    const dirFiles: { path: string; content: string }[] = [];
    let dir = projectPath;
    const root = parsePath(dir).root;

    while (dir !== root) {
        const claudeFile = join(dir, 'CLAUDE.md');
        if (existsSync(claudeFile)) {
            dirFiles.push({ path: dir, content: readFileSync(claudeFile, 'utf-8') });
        }
        if (existsSync(join(dir, '.git'))) break;
        dir = dirname(dir);
    }

    // Reverse so outermost directory comes first
    dirFiles.reverse();
    files.push(...dirFiles.map(f => f.content));

    return files.join('\n\n---\n\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/summary.test.ts`
Expected: All tests PASS

Note: The `loadClaudeMdChain` function also reads `~/.claude/CLAUDE.md` from the real home directory. The tests above use synthetic directories in `TEST_DIR` and don't assert against global CLAUDE.md content. If the global file exists, it will be included in the chain output but the test assertions are designed to still pass.

- [ ] **Step 5: Commit**

```
git add src/summary.ts test/summary.test.ts
git commit -m "feat: add CLAUDE.md chain loader for summary deduplication"
```

---

## Chunk 2: Prompts, Generation, and Integration

### Task 5: Create prompt templates

**Files:**
- Create: `src/prompts/summarize-full.md`
- Create: `src/prompts/summarize-incremental.md`

- [ ] **Step 1: Create the full regeneration prompt**

Create `src/prompts/summarize-full.md`:

```markdown
You are a memory summarization agent. Generate a concise prose summary of all project memories.

TARGET TOKEN BUDGET: {{TOKEN_BUDGET}} tokens (approximately {{CHAR_BUDGET}} characters). Stay within this budget.

MEMORIES (JSON array with id, content, tags, domain, category, importance):
{{MEMORIES}}

{{CLAUDE_MD_SECTION}}

{{PREVIOUS_SUMMARY_SECTION}}

INSTRUCTIONS:
- Write a prose summary that captures the essential knowledge from all memories
- Include memory ID references inline as (#id) or (#id, #id) so the reader can look up specifics
- Group related information thematically (architecture, patterns, decisions, etc.)
- Prioritize higher-importance memories (importance 4-5 are critical, 1-2 are trivia)
- Be concise — every sentence should convey useful information
- Do NOT use bullet points or lists — write flowing prose paragraphs
- Do NOT include any JSON, code blocks, or structured formatting
- Output ONLY the summary text, nothing else
```

- [ ] **Step 2: Create the incremental update prompt**

Create `src/prompts/summarize-incremental.md`:

```markdown
You are a memory summarization agent. Update an existing project summary to incorporate new or changed memories.

TARGET TOKEN BUDGET: {{TOKEN_BUDGET}} tokens (approximately {{CHAR_BUDGET}} characters). Stay within this budget.

EXISTING SUMMARY:
{{EXISTING_SUMMARY}}

{{DELTA_TYPE_LABEL}}:
{{DELTA_MEMORIES}}

{{CLAUDE_MD_SECTION}}

INSTRUCTIONS:
- Incorporate the new/changed memories into the existing summary
- Keep the summary within the token budget — you may need to compress or merge older content to make room
- Maintain inline memory ID references as (#id) or (#id, #id)
- Preserve the thematic grouping and prose style of the existing summary
- Do NOT use bullet points or lists — write flowing prose paragraphs
- Do NOT repeat information already covered in CLAUDE.md (if provided)
- Output ONLY the updated summary text, nothing else
```

- [ ] **Step 3: Commit**

```
git add src/prompts/summarize-full.md src/prompts/summarize-incremental.md
git commit -m "feat: add summarization prompt templates"
```

---

### Task 6: Summary generation function

**Files:**
- Modify: `src/summary.ts`

This task adds `generateSummary()` which calls the LLM via Agent SDK. It is not unit-tested directly (follows the same pattern as `synthesizeMemories()`, `cleanupWithLLM()`, and `enrichProjects()` in `worker.ts` which also skip LLM mocking). The function will be integration-tested via the worker loop.

- [ ] **Step 1: Add imports and loadPrompt helper**

Add to the top of `src/summary.ts`:

```typescript
import { getProjectSummaryState, updateProjectSummary, getDb } from './db.js';
import { broadcast } from './sse.js';
import { log, error as logError } from './logger.js';

function loadPrompt(name: string, vars: Record<string, string> = {}): string {
    const promptsDir = join(dirname(fileURLToPath(import.meta.url)), 'prompts');
    let text = readFileSync(join(promptsDir, `${name}.md`), 'utf-8');
    for (const [key, value] of Object.entries(vars)) {
        text = text.replaceAll(`{{${key}}}`, value);
    }
    return text;
}
```

Add `import { fileURLToPath } from 'node:url';` to imports.

- [ ] **Step 2: Implement generateSummary**

Add to `src/summary.ts`:

```typescript
export async function generateSummary(
    projectId: number,
    mode: 'full' | 'incremental',
    deltaMemoryIds?: number[],
): Promise<boolean> {
    const state = getProjectSummaryState(projectId);
    const memories = getMemoriesForHashing(projectId);
    const config = getConfig();
    const budget = config.context.memoryTokenBudget;
    const charBudget = budget * 4;

    // Look up project path for CLAUDE.md
    const db = getDb();
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return false;

    const claudeMd = loadClaudeMdChain(project.path);
    const claudeMdSection = claudeMd
        ? `The following is the project's CLAUDE.md chain, which the user already sees at session start. Do NOT repeat information already covered there:\n\n${claudeMd}`
        : '';

    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        let prompt: string;

        if (mode === 'full') {
            const memoriesJson = JSON.stringify(
                memories.map(m => ({
                    id: m.id, content: m.content, tags: m.tags,
                    domain: m.domain, category: m.category, importance: m.importance,
                })),
                null, 2,
            );
            const prevSection = state.summary
                ? `PREVIOUS SUMMARY (preserve what is still accurate, adjust what changed):\n${state.summary}`
                : '';

            prompt = loadPrompt('summarize-full', {
                TOKEN_BUDGET: String(budget),
                CHAR_BUDGET: String(charBudget),
                MEMORIES: memoriesJson,
                CLAUDE_MD_SECTION: claudeMdSection,
                PREVIOUS_SUMMARY_SECTION: prevSection,
            });
        } else {
            const deltaMemories = (deltaMemoryIds || [])
                .map(id => memories.find(m => m.id === id))
                .filter(Boolean);

            const hasAdded = deltaMemoryIds?.some(id => {
                const snap = state.summary_snapshot ? JSON.parse(state.summary_snapshot) : {};
                return !(id in snap);
            });
            const hasUpdated = deltaMemoryIds?.some(id => {
                const snap = state.summary_snapshot ? JSON.parse(state.summary_snapshot) : {};
                return id in snap;
            });
            let deltaType = 'New memories';
            if (hasAdded && hasUpdated) deltaType = 'New and updated memories';
            else if (hasUpdated) deltaType = 'Updated memories';

            prompt = loadPrompt('summarize-incremental', {
                TOKEN_BUDGET: String(budget),
                CHAR_BUDGET: String(charBudget),
                EXISTING_SUMMARY: state.summary,
                DELTA_TYPE_LABEL: deltaType,
                DELTA_MEMORIES: JSON.stringify(
                    deltaMemories.map(m => ({
                        id: m!.id, content: m!.content, tags: m!.tags,
                        domain: m!.domain, category: m!.category, importance: m!.importance,
                    })),
                    null, 2,
                ),
                CLAUDE_MD_SECTION: claudeMdSection,
            });
        }

        let result = '';
        for await (const message of query({
            prompt,
            options: {
                allowedTools: [],
                permissionMode: 'bypassPermissions',
                model: 'haiku',
            },
        })) {
            if ('result' in message) result = message.result as string;
        }

        // Validate result — must be non-empty text (not JSON, not empty)
        const trimmed = result.trim();
        if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
            logError('summary', `LLM returned invalid summary format, skipping`);
            return false;
        }

        // Compute new snapshot and hash
        const newSnapshot = computeMemorySnapshot(projectId);
        const newHash = computeMemoryHash(projectId);
        const incrementalCount = mode === 'full' ? 0 : state.summary_incremental_count + 1;

        updateProjectSummary(
            projectId,
            trimmed,
            newHash,
            JSON.stringify(newSnapshot),
            incrementalCount,
        );

        broadcast('summary:updated', { projectId });
        log('summary', `${mode === 'full' ? 'Full' : 'Incremental'} summary generated for project ${project.path} (${trimmed.length} chars)`);
        return true;
    } catch (err) {
        logError('summary', `Summary generation failed for project ${projectId}: ${err}`);
        return false;
    }
}
```

- [ ] **Step 3: Commit**

```
git add src/summary.ts
git commit -m "feat: add LLM-powered summary generation with full and incremental modes"
```

---

### Task 7: Worker integration — checkProjectSummaries

**Files:**
- Modify: `src/summary.ts`
- Modify: `src/worker.ts`

- [ ] **Step 1: Add checkProjectSummaries to summary.ts**

Add to `src/summary.ts`:

```typescript
import { listProjects } from './db.js';

export async function checkProjectSummaries(): Promise<void> {
    const config = getConfig();
    const projects = listProjects() as { id: number; path: string }[];

    for (const project of projects) {
        try {
            const currentHash = computeMemoryHash(project.id);
            const state = getProjectSummaryState(project.id);

            // Skip if nothing changed
            if (currentHash === state.summary_hash) continue;

            // Check quiet period — no memory activity in last N ms
            const memories = getMemoriesForHashing(project.id);
            if (memories.length === 0) continue;

            const lastActivity = Math.max(
                ...memories.map(m => new Date(m.updated_at).getTime()),
            );
            const quietMs = config.worker.summary.quietPeriodMs;
            if (Date.now() - lastActivity < quietMs) continue;

            // Determine delta
            const currentSnapshot = computeMemorySnapshot(project.id);
            const oldSnapshot: Record<number, string> = state.summary_snapshot
                ? JSON.parse(state.summary_snapshot)
                : {};
            const delta = computeSummaryDelta(currentSnapshot, oldSnapshot);

            // Decide mode
            let mode: 'full' | 'incremental';
            let deltaIds: number[] | undefined;

            if (
                !state.summary ||
                delta.deleted.length > 0 ||
                state.summary_incremental_count >= config.worker.summary.maxIncrementalCycles
            ) {
                mode = 'full';
            } else {
                mode = 'incremental';
                deltaIds = [...delta.added, ...delta.updated];
            }

            log('summary', `Project "${project.path}": ${mode} summary (added=${delta.added.length}, updated=${delta.updated.length}, deleted=${delta.deleted.length}, cycle=${state.summary_incremental_count})`);
            await generateSummary(project.id, mode, deltaIds);
        } catch (err) {
            logError('summary', `Summary check failed for project ${project.path}: ${err}`);
        }
    }
}
```

- [ ] **Step 2: Hook into the worker poll loop**

In `src/worker.ts`, add the import:

```typescript
import { checkProjectSummaries } from './summary.js';
```

In the `startWorker()` function, add summary checking to the poll loop. Add it **after** the existing `enrichProjects` block (which is after `pollCount++`). The existing code increments `pollCount` before the modulo checks, so `pollCount` is 1 on the first poll:

```typescript
const summaryEvery = Math.max(1, Math.round(getConfig().worker.summary.checkIntervalMs / getConfig().worker.pollIntervalMs));
if (pollCount % summaryEvery === 0) {
    await checkProjectSummaries();
}
```

Note: With `summaryEvery = 12` (60000ms / 5000ms), the first summary check fires at `pollCount === 12` (~60s after startup). This matches the `enrichProjects` convention where the first enrichment fires at `pollCount === 10` (~50s), not immediately. If immediate-on-startup is desired, change the condition to `pollCount === 1 || pollCount % summaryEvery === 0`.

- [ ] **Step 3: Build and verify no compile errors**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```
git add src/summary.ts src/worker.ts
git commit -m "feat: integrate summary check loop into worker"
```

---

### Task 8: Modify buildStartupContext to use cached summaries

**Files:**
- Modify: `src/context.ts`
- Modify: `test/context-domains.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/context-domains.test.ts`:

```typescript
import { updateProjectSummary } from '../src/db.js';

describe('summary-based context injection', () => {
    it('uses deterministic formatter when all memories fit in budget', () => {
        const proj = getOrCreateProject('test-small');
        insertMemory(proj.id, 'short memory', '', 'fact', 3, '', 'frontend');

        const context = buildStartupContext('test-small');
        // Should use deterministic format (structured lines)
        expect(context).toContain('### Frontend');
        expect(context).toContain('short memory');
        expect(context).not.toContain('Project Summary');
    });

    it('uses cached summary when memories exceed budget and summary exists', () => {
        const proj = getOrCreateProject('test-large');
        // Insert many memories to exceed the default 1000 token budget
        for (let i = 0; i < 30; i++) {
            insertMemory(
                proj.id,
                `This is a detailed memory about topic ${i} with enough content to consume tokens. It describes an important architectural decision regarding component ${i} and how it integrates with the broader system.`,
                `tag${i},implementation`,
                'fact',
                3,
                '',
                'frontend',
            );
        }

        // Store a cached summary
        updateProjectSummary(proj.id, 'This is the cached summary about the project (#1, #2).', 'somehash', '{}', 0);

        const context = buildStartupContext('test-large');
        expect(context).toContain('Project Summary');
        expect(context).toContain('This is the cached summary about the project (#1, #2).');
        // Should NOT contain the deterministic format
        expect(context).not.toContain('### Frontend');
    });

    it('falls back to deterministic when summary exceeds budget', () => {
        const proj = getOrCreateProject('test-oversized');
        for (let i = 0; i < 30; i++) {
            insertMemory(
                proj.id,
                `Detailed memory ${i} with substantial content for budget testing purposes and architectural descriptions.`,
                `tag${i}`,
                'fact',
                3,
                '',
                'frontend',
            );
        }

        // Store an oversized summary (way over the 1000 token / 4000 char budget)
        const hugeSummary = 'x'.repeat(6000);
        updateProjectSummary(proj.id, hugeSummary, 'hash', '{}', 0);

        const context = buildStartupContext('test-oversized');
        // Should fall back to deterministic since summary is too large
        expect(context).not.toContain('Project Summary');
    });

    it('falls back to deterministic when no summary exists yet', () => {
        const proj = getOrCreateProject('test-nosummary');
        for (let i = 0; i < 30; i++) {
            insertMemory(
                proj.id,
                `Another detailed memory ${i} with enough content to push past the token budget threshold for deterministic formatting.`,
                `tag${i}`,
                'fact',
                3,
                '',
                'frontend',
            );
        }
        // No summary stored — should use deterministic
        const context = buildStartupContext('test-nosummary');
        expect(context).not.toContain('Project Summary');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/context-domains.test.ts`
Expected: FAIL — tests expecting `Project Summary` header or its absence don't match current behavior

- [ ] **Step 3: Implement the branching logic in buildStartupContext**

Modify `src/context.ts`. Add import:

```typescript
import { getProjectSummaryState } from './db.js';
```

Refactor `buildStartupContext()`: extract the existing memory grouping/selection/formatting into a helper `buildDeterministicMemories()`, then add a three-way branch before the taxonomy sections.

The full refactored file (showing all changes — taxonomy/tags/tip/dashboard sections are untouched):

```typescript
import { listMemories, listTags, getOrCreateProject, listDomainsRaw, listCategoriesRaw, getProjectSummaryState } from './db.js';
import { log } from './logger.js';
import { getConfig } from './config.js';

const CHARS_PER_TOKEN = 4;

function formatMemoryLine(m: any): string {
    return `- [${m.category}] (${m.importance}) ${m.content}${m.tags ? ` tags: ${m.tags}` : ''}`;
}

/**
 * Build the deterministic (structured) memory section.
 * Extracted from the original buildStartupContext logic — groups by domain,
 * selects top-1 per domain then fills by importance within budget.
 */
function buildDeterministicMemories(
    allMemories: any[],
    maxMemoryChars: number,
): { text: string; selectedCount: number; totalCount: number; domainNames: string[] } {
    const totalCount = allMemories.length;

    // Group memories by domain
    const byDomain: Record<string, typeof allMemories> = {};
    for (const m of allMemories) {
        const domain = m.domain || 'general';
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push(m);
    }

    const domainNames = Object.keys(byDomain).sort();
    const selected: { domain: string; memory: any }[] = [];
    const used = new Set<number>();
    let charCount = 0;

    // Phase 1: top-1 per domain
    for (const domain of domainNames) {
        const top = byDomain[domain][0];
        if (top) {
            const line = formatMemoryLine(top);
            if (charCount + line.length <= maxMemoryChars) {
                selected.push({ domain, memory: top });
                used.add(top.id);
                charCount += line.length;
            }
        }
    }

    // Phase 2: fill remaining budget by importance across all domains
    const remaining = allMemories.filter(m => !used.has(m.id));
    for (const m of remaining) {
        const line = formatMemoryLine(m);
        if (charCount + line.length > maxMemoryChars) break;
        selected.push({ domain: m.domain || 'general', memory: m });
        charCount += line.length;
    }

    // Build grouped output
    const grouped: Record<string, string[]> = {};
    for (const { domain, memory } of selected) {
        if (!grouped[domain]) grouped[domain] = [];
        grouped[domain].push(formatMemoryLine(memory));
    }

    const lines: string[] = [];
    const selectedCount = selected.length;

    if (selectedCount > 0) {
        lines.push(`\n## Memories (${selectedCount} of ${totalCount})\n`);
        lines.push(`**Legend:**`);
        lines.push(`> H3 headings = domain (count shown of total)`);
        lines.push(`> Line format: \`- [category] (importance) content tags: t1,t2\``);
        lines.push(`> Importance: 1=trivia, 2=useful, 3=normal, 4=important, 5=critical`);

        const sortedDomains = Object.keys(grouped).sort();
        for (const domain of sortedDomains) {
            const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
            const domainTotal = byDomain[domain]?.length ?? grouped[domain].length;
            const shownCount = grouped[domain].length;
            const countLabel = shownCount < domainTotal
                ? `${shownCount} of ${domainTotal}`
                : `${shownCount}`;
            lines.push(`\n### ${domainLabel} (${countLabel})`);
            lines.push(...grouped[domain]);
        }
    } else {
        lines.push('\nNo memories yet for this project. Use save_memory or /remember to start building context.');
    }

    return { text: lines.join('\n'), selectedCount, totalCount, domainNames };
}

export function buildStartupContext(projectPath: string): string {
    const project = getOrCreateProject(projectPath);
    const allMemories = listMemories(projectPath, undefined, undefined, 100);
    const tags = listTags(projectPath);

    const maxMemoryChars = getConfig().context.memoryTokenBudget * CHARS_PER_TOKEN;
    const budgetWithTolerance = (getConfig().context.memoryTokenBudget + 200) * CHARS_PER_TOKEN;

    const lines: string[] = [];
    lines.push(`<memory-context project="${projectPath}">`);

    // Compute total formatted size to decide which path to take
    const totalFormattedChars = allMemories.reduce(
        (sum: number, m: any) => sum + formatMemoryLine(m).length, 0
    );

    let selectedCount = 0;
    const totalCount = allMemories.length;
    let domainNames: string[] = [];

    if (totalFormattedChars <= budgetWithTolerance) {
        // Path A: Everything fits — use deterministic formatter
        const result = buildDeterministicMemories(allMemories, maxMemoryChars);
        lines.push(result.text);
        selectedCount = result.selectedCount;
        domainNames = result.domainNames;
    } else {
        // Check for cached summary
        const summaryState = getProjectSummaryState(project.id);
        const summaryFits = summaryState.summary
            && summaryState.summary.length <= budgetWithTolerance;

        if (summaryFits) {
            // Path B: Use cached LLM summary
            lines.push('\n## Project Summary');
            lines.push('> Below is a synthesis of all memories for this project. References like (#123, #456)');
            lines.push('> point to specific memory IDs -- use `search_memories` to query them directly.\n');
            lines.push(summaryState.summary);
            selectedCount = totalCount; // summary covers all
            // Derive domainNames for the tip section
            const byDomain: Record<string, boolean> = {};
            for (const m of allMemories) byDomain[m.domain || 'general'] = true;
            domainNames = Object.keys(byDomain).sort();
        } else {
            // Path C: Fallback to deterministic (truncated)
            const result = buildDeterministicMemories(allMemories, maxMemoryChars);
            lines.push(result.text);
            selectedCount = result.selectedCount;
            domainNames = result.domainNames;
        }
    }

    // ── Tags section (unchanged) ──
    let tagChars = 0;
    const maxTagChars = getConfig().context.tagsTokenBudget * CHARS_PER_TOKEN;
    const selectedTags: string[] = [];

    for (const t of tags) {
        const entry = `${t.tag}(${t.count})`;
        if (tagChars + entry.length + 2 > maxTagChars) break;
        selectedTags.push(entry);
        tagChars += entry.length + 2;
    }

    if (selectedTags.length > 0) {
        lines.push(`\n## Tags (name followed by memory count)\n${selectedTags.join(', ')}`);
    }

    // ── Taxonomy sections (unchanged) ──
    const allDomains = listDomainsRaw();
    if (allDomains.length > 0) {
        lines.push(`\n## Available Domains\n${allDomains.map(d => d.name).join(', ')}`);
    }

    const allCategories = listCategoriesRaw();
    if (allCategories.length > 0) {
        lines.push(
            `\n## Available Categories\n${allCategories.map(c => `${c.name}: ${c.description}`).join('\n')}`,
        );
    }

    // ── Tip section (unchanged) ──
    if (selectedCount > 0 && selectedCount < totalCount) {
        const domainList = domainNames.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');
        lines.push(`\n> **Tip:** Only ${selectedCount} of ${totalCount} memories are shown above. If your task is heavy on a specific domain (${domainList}), use the \`search_memories\` MCP tool to retrieve deeper context for that domain.`);
    }

    const port = getConfig().server.port;
    lines.push(`\n## ai-memory Dashboard\nManage memories and observations at http://localhost:${port}`);

    lines.push('\n</memory-context>');
    log('context', `Injected ${selectedCount} of ${totalCount} memories across ${domainNames.length} domains for ${projectPath}`);
    return lines.join('\n');
}
```

This is the complete file — it replaces the existing `src/context.ts` content entirely.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/context-domains.test.ts`
Expected: All tests PASS (both old and new)

- [ ] **Step 5: Run full test suite**

Run: `pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Step 6: Build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```
git add src/context.ts test/context-domains.test.ts
git commit -m "feat: use cached LLM summary in context injection with deterministic fallback"
```

---

### Task 9: Final integration test and cleanup

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Step 2: Build and verify**

Run: `pnpm build`
Expected: Clean build, no warnings

- [ ] **Step 3: Manual smoke test**

Start the server with `pnpm start`, verify:
1. Dashboard loads at configured port
2. Check server logs for summary check messages in the worker loop
3. Context injection still works (create a test session or hit `/context` endpoint)

- [ ] **Step 4: Final commit if any fixups needed**

```
git add -A
git commit -m "fix: integration fixups for summary-based context injection"
```
