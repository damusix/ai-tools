# Search Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace word-only FTS5 search with dual-index architecture (word + trigram) and add prefix wildcards, taxonomy injection, limit=0, and a dashboard search bar.

**Architecture:** Word-based FTS5 for precision results ranked first, trigram FTS5 for substring fallback. `/api/search` queries both and deduplicates. PreToolUse hook injects taxonomy context for LLM search quality. SolidJS search bar calls the new endpoint.

**Tech Stack:** SQLite FTS5 (trigram tokenizer), better-sqlite3, Hono, SolidJS, Vitest

**Spec:** `docs/superpowers/specs/2026-03-14-search-improvements-design.md`

---

## File Map

| File | Responsibility | Action |
|------|---------------|--------|
| `src/db.ts` | Schema, queries, FTS tables | Modify: add trigram table/triggers/backfill, `searchMemoriesFuzzy()`, conditional LIMIT |
| `src/app.ts` | HTTP routes | Modify: prefix wildcards in recall, new `/api/search`, new `/api/taxonomy-summary` |
| `src/tools.ts` | MCP tool definitions | Modify: limit defaults and descriptions |
| `src/context.ts` | Session startup context | Modify: add domain/category lists |
| `hooks/hooks.json` | Hook config | Modify: add PreToolUse matcher |
| `hooks/scripts/search-context.sh` | Taxonomy injection script | Create |
| `src/ui/App.tsx` | Dashboard main component | Modify: search bar + results view |
| `test/search.test.ts` | Search-specific tests | Create |

---

## Chunk 1: Backend — Trigram Index + limit=0

### Task 1: Trigram FTS5 table, triggers, and backfill

**Files:**
- Modify: `src/db.ts:136` (after existing FTS triggers in `initSchema()`)
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/search.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    initDb,
    closeDb,
    getDb,
    getOrCreateProject,
    insertMemory,
    searchMemories,
} from '../src/db.js';

const TMP_DIR = join(import.meta.dirname, '.');
let dbPath: string;

function cleanupDb(p: string) {
    for (const suffix of ['', '-wal', '-shm']) {
        const f = p + suffix;
        if (existsSync(f)) unlinkSync(f);
    }
}

beforeEach(() => {
    dbPath = join(TMP_DIR, `test-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDb(dbPath);
});

afterEach(() => {
    closeDb();
    cleanupDb(dbPath);
});

describe('Trigram FTS5', () => {
    it('memories_trigram table is created during initSchema', () => {
        const db = getDb();
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_trigram'"
        ).all();
        expect(tables).toHaveLength(1);
    });

    it('trigram triggers sync on insert', () => {
        const db = getDb();
        const proj = getOrCreateProject('/test/trigram');
        insertMemory(proj.id, 'websocket connection handling', 'websocket,networking', 'fact', 3, '', 'backend');
        const count = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(count).toBe(1);
    });

    it('trigram triggers sync on delete', () => {
        const db = getDb();
        const proj = getOrCreateProject('/test/trigram');
        insertMemory(proj.id, 'websocket test', 'ws', 'fact', 3, '', 'backend');
        db.prepare('DELETE FROM memories WHERE content = ?').run('websocket test');
        const count = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(count).toBe(0);
    });

    it('backfill populates trigram table from existing memories', () => {
        const db = getDb();
        const proj = getOrCreateProject('/test/backfill');
        insertMemory(proj.id, 'memory one', 'tag1', 'fact', 3, '', 'general');
        insertMemory(proj.id, 'memory two', 'tag2', 'fact', 3, '', 'general');

        // Manually clear trigram table to simulate pre-migration state
        db.exec('DELETE FROM memories_trigram');
        const before = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(before).toBe(0);

        // Re-run initSchema — backfill should repopulate
        closeDb();
        initDb(dbPath);
        const after = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(after).toBe(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — `memories_trigram` table does not exist

- [ ] **Step 3: Implement trigram table, triggers, and backfill**

In `src/db.ts`, inside the `initSchema()` template literal, after the `memories_au` trigger (after line 136), add:

```sql
        -- Trigram FTS for substring matching (fallback search)
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_trigram
            USING fts5(content, tags, content=memories, content_rowid=id, tokenize="trigram");

        -- Trigram sync triggers
        CREATE TRIGGER IF NOT EXISTS memories_trigram_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_trigram_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_trigram(memories_trigram, rowid, content, tags)
                VALUES ('delete', old.id, old.content, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_trigram_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_trigram(memories_trigram, rowid, content, tags)
                VALUES ('delete', old.id, old.content, old.tags);
            INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END;
```

Then, after the `db.exec(schema)` call and any existing migrations, add the backfill:

```typescript
    // Backfill trigram index from existing memories
    const trigramCount = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
    const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
    if (trigramCount < memoryCount) {
        db.transaction(() => {
            db.exec('DELETE FROM memories_trigram');
            db.exec(
                'INSERT INTO memories_trigram(rowid, content, tags) SELECT id, content, tags FROM memories',
            );
        })();
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: All 4 trigram tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.ts test/search.test.ts
git commit -m "feat: add trigram FTS5 table with sync triggers and backfill"
```

---

### Task 2: limit=0 support

**Files:**
- Modify: `src/db.ts:273,389,424` (three query functions)
- Modify: `src/tools.ts:62,105` (MCP tool defaults)
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/search.test.ts`:

```typescript
import {
    // ... existing imports ...
    listMemories,
    searchObservations,
    insertObservation,
} from '../src/db.js';

describe('limit=0 (unlimited)', () => {
    it('searchMemories with limit=0 returns all results', () => {
        const proj = getOrCreateProject('/test/limit');
        for (let i = 0; i < 25; i++) {
            insertMemory(proj.id, `memory ${i}`, `tag${i}`, 'fact', 3, '', 'general');
        }
        const limited = searchMemories('memory*', '/test/limit', undefined, undefined, 5);
        expect(limited).toHaveLength(5);
        const unlimited = searchMemories('memory*', '/test/limit', undefined, undefined, 0);
        expect(unlimited).toHaveLength(25);
    });

    it('listMemories with limit=0 returns all results', () => {
        const proj = getOrCreateProject('/test/limit2');
        for (let i = 0; i < 25; i++) {
            insertMemory(proj.id, `list item ${i}`, '', 'fact', 3, '', 'general');
        }
        const limited = listMemories('/test/limit2', undefined, undefined, 5);
        expect(limited).toHaveLength(5);
        const unlimited = listMemories('/test/limit2', undefined, undefined, 0);
        expect(unlimited).toHaveLength(25);
    });

    it('searchObservations with limit=0 returns all results', () => {
        const proj = getOrCreateProject('/test/limit3');
        for (let i = 0; i < 25; i++) {
            insertObservation(proj.id, `obs ${i}`, 'test');
        }
        const limited = searchObservations('obs*', '/test/limit3', 5);
        expect(limited).toHaveLength(5);
        const unlimited = searchObservations('obs*', '/test/limit3', 0);
        expect(unlimited).toHaveLength(25);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — limit=0 returns 0 results (SQLite `LIMIT 0` returns nothing)

- [ ] **Step 3: Make LIMIT conditional in all three functions**

In `src/db.ts`, modify `searchObservations()` (around line 273). Change:

```typescript
    sql += ` ORDER BY o.created_at DESC LIMIT ?`;
    params.push(limit);
```

to:

```typescript
    sql += ' ORDER BY o.created_at DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }
```

In `src/db.ts`, modify `searchMemories()` (around line 389). Change:

```typescript
    sql += ' ORDER BY m.importance DESC, m.created_at DESC LIMIT ?';
    params.push(limit);
```

to:

```typescript
    sql += ' ORDER BY m.importance DESC, m.created_at DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }
```

In `src/db.ts`, modify `listMemories()` (around line 424). Change:

```typescript
        ORDER BY m.importance DESC, m.created_at DESC
        LIMIT ?
    `;
    params.push(limit);
```

to:

```typescript
        ORDER BY m.importance DESC, m.created_at DESC
    `;
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }
```

Note: the `listMemories()` function uses a template literal for `sql` — the `LIMIT ?` must be removed from inside the template and the conditional appended after it.

- [ ] **Step 4: Update MCP tool defaults and descriptions**

In `src/tools.ts`, in the `search_memories` tool (line 62), change:

```typescript
limit: z.number().default(20),
```

to:

```typescript
limit: z.number().default(20).describe('Result limit. 0 = no limit.'),
```

In the `list_memories` tool (line 105), change:

```typescript
limit: z.number().default(50),
```

to:

```typescript
limit: z.number().default(500).describe('Result limit. 0 = no limit.'),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: All limit=0 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm vitest run test/`
Expected: All existing tests still PASS

- [ ] **Step 7: Commit**

```bash
git add src/db.ts src/tools.ts test/search.test.ts
git commit -m "feat: support limit=0 for unlimited results in search and list functions"
```

---

### Task 3: searchMemoriesFuzzy()

**Files:**
- Modify: `src/db.ts` (add new function after `searchMemories()`)
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/search.test.ts` imports and tests:

```typescript
import {
    // ... existing imports ...
    searchMemoriesFuzzy,
} from '../src/db.js';

describe('searchMemoriesFuzzy (trigram)', () => {
    it('finds substring matches that word-based search misses', () => {
        const proj = getOrCreateProject('/test/fuzzy');
        insertMemory(proj.id, 'websocket connection handling', 'websocket,networking', 'fact', 3, '', 'backend');
        insertMemory(proj.id, 'REST API authentication flow', 'auth,api', 'solution', 4, '', 'backend');

        // Word-based search: "socket" does NOT match "websocket" (no prefix)
        const wordResults = searchMemories('socket', '/test/fuzzy');
        expect(wordResults).toHaveLength(0);

        // Trigram search: "socket" DOES match "websocket" (substring)
        const trigramResults = searchMemoriesFuzzy('socket', '/test/fuzzy');
        expect(trigramResults.length).toBeGreaterThan(0);
        expect(trigramResults[0].content).toContain('websocket');
    });

    it('respects domain filter', () => {
        const proj = getOrCreateProject('/test/fuzzy2');
        insertMemory(proj.id, 'websocket in frontend', 'ws', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'websocket in backend', 'ws', 'fact', 3, '', 'backend');

        const results = searchMemoriesFuzzy('socket', '/test/fuzzy2', undefined, undefined, 20, 'frontend');
        expect(results).toHaveLength(1);
        expect(results[0].domain).toBe('frontend');
    });

    it('does not use * prefix operator (trigram does not support it)', () => {
        const proj = getOrCreateProject('/test/fuzzy3');
        insertMemory(proj.id, 'authentication system design', 'auth', 'solution', 4, '', 'backend');

        // Raw word without *, trigram should still match substring "auth" within "authentication"
        const results = searchMemoriesFuzzy('auth', '/test/fuzzy3');
        expect(results.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — `searchMemoriesFuzzy` is not exported from `../src/db.js`

- [ ] **Step 3: Implement searchMemoriesFuzzy()**

In `src/db.ts`, add after `searchMemories()` (after line 393):

```typescript
export function searchMemoriesFuzzy(
    query: string,
    projectPath?: string,
    tag?: string,
    category?: string,
    limit = 20,
    domain?: string,
): any[] {
    const db = getDb();
    let sql = `
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain,
               m.created_at, m.updated_at, m.reason, p.path as project_path
        FROM memories m
        JOIN memories_trigram f ON m.id = f.rowid
        JOIN projects p ON m.project_id = p.id
        WHERE memories_trigram MATCH ?
    `;
    const params: any[] = [query];

    if (projectPath) {
        sql += " AND (p.path = ? OR p.path = '_global')";
        params.push(projectPath);
    }
    if (tag) {
        sql += ' AND m.tags LIKE ?';
        params.push(`%${tag}%`);
    }
    if (category) {
        sql += ' AND m.category = ?';
        params.push(category);
    }
    if (domain) {
        sql += ' AND m.domain = ?';
        params.push(domain);
    }
    sql += ' ORDER BY rank, m.importance DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: All fuzzy search tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.ts test/search.test.ts
git commit -m "feat: add searchMemoriesFuzzy() for trigram substring matching"
```

---

## Chunk 2: Backend — API Endpoints

### Task 4: Prefix wildcards in /api/recall

**Files:**
- Modify: `src/app.ts:307-317`
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/search.test.ts`:

```typescript
import { createApp } from '../src/app.js';

function makeApp() {
    return createApp();
}

async function req(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.request(path, init);
}

describe('POST /api/recall prefix wildcards', () => {
    it('prefix match: "auth" finds "authentication"', async () => {
        const proj = getOrCreateProject('/test/recall');
        insertMemory(proj.id, 'authentication system uses JWT tokens', 'auth,jwt', 'solution', 4, '', 'backend');

        const app = makeApp();
        const res = await req(app, 'POST', '/api/recall', {
            prompt: 'how does auth work',
            project: '/test/recall',
        });
        const json = await res.json() as any;
        expect(json.memories.length).toBeGreaterThan(0);
        expect(json.memories[0].content).toContain('authentication');
    });

    it('single-char words are filtered out', async () => {
        const proj = getOrCreateProject('/test/recall2');
        insertMemory(proj.id, 'a test memory about nothing', 'test', 'fact', 3, '', 'general');

        const app = makeApp();
        // All words are single-char or stop words — should return empty
        const res = await req(app, 'POST', '/api/recall', {
            prompt: 'a b c',
            project: '/test/recall2',
        });
        const json = await res.json() as any;
        expect(json.memories).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — "auth" does not match "authentication" (no prefix wildcard)

- [ ] **Step 3: Add prefix wildcards and min-length filter**

In `src/app.ts`, replace the recall query construction (around lines 313-317):

```typescript
            const unique = [...new Set(words)].slice(0, 5);
            if (unique.length === 0) return c.json({ memories: [] });

            const ftsQuery = unique.join(' OR ');
```

with:

```typescript
            const unique = [...new Set(words)].slice(0, 5);
            if (unique.length === 0) return c.json({ memories: [] });

            const filtered = unique.filter(w => w.length >= 2);
            if (filtered.length === 0) return c.json({ memories: [] });
            const ftsQuery = filtered.map(w => w + '*').join(' OR ');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.ts test/search.test.ts
git commit -m "feat: add prefix wildcards to /api/recall for better search matching"
```

---

### Task 5: /api/taxonomy-summary endpoint

**Files:**
- Modify: `src/app.ts`
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/search.test.ts`:

```typescript
describe('GET /api/taxonomy-summary', () => {
    it('returns JSON with summary field', async () => {
        const proj = getOrCreateProject('/test/taxonomy');
        insertMemory(proj.id, 'test memory', 'typescript,api', 'fact', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/taxonomy-summary?project=/test/taxonomy');
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(typeof json.summary).toBe('string');
        expect(json.summary).toContain('Domains:');
        expect(json.summary).toContain('Categories:');
    });

    it('filters to items with count > 0', async () => {
        const proj = getOrCreateProject('/test/taxonomy2');
        insertMemory(proj.id, 'only backend memory', 'ts', 'solution', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/taxonomy-summary?project=/test/taxonomy2');
        const json = await res.json() as any;
        // "backend" should appear with count, unused domains should not
        expect(json.summary).toContain('backend');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — 404, endpoint does not exist

- [ ] **Step 3: Implement /api/taxonomy-summary**

In `src/app.ts`, first add `listTags` to the import from `./db.js` (it is NOT currently imported — add it to the existing import block at the top of the file alongside `listDomains`, `listCategories`, etc.). Then add the endpoint:

```typescript
    app.get('/api/taxonomy-summary', (c) => {
        const project = c.req.query('project');
        const domains = listDomains(project).filter(d => d.count > 0);
        const categories = listCategories(project).filter(cat => cat.count > 0);
        const tags = listTags(project).slice(0, 20);

        const parts: string[] = [];
        if (domains.length > 0) {
            parts.push('Domains: ' + domains.map(d => `${d.name}(${d.count})`).join(', '));
        }
        if (categories.length > 0) {
            parts.push('Categories: ' + categories.map(cat => `${cat.name}(${cat.count})`).join(', '));
        }
        if (tags.length > 0) {
            parts.push('Top tags: ' + tags.map(t => `${t.tag}(${t.count})`).join(', '));
        }

        return c.json({ summary: parts.join('\n') });
    });
```

Verify: `listDomains` and `listCategories` are already imported. You added `listTags` above. All three must be present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.ts test/search.test.ts
git commit -m "feat: add /api/taxonomy-summary endpoint for hook consumption"
```

---

### Task 6: /api/search endpoint (combined word + trigram)

**Files:**
- Modify: `src/app.ts`
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/search.test.ts`:

```typescript
import { searchMemoriesFuzzy } from '../src/db.js';

describe('GET /api/search', () => {
    it('returns word-based results for exact matches', async () => {
        const proj = getOrCreateProject('/test/search');
        insertMemory(proj.id, 'authentication flow using JWT', 'auth', 'solution', 4, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/search?q=authentication&project=/test/search');
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.results.length).toBeGreaterThan(0);
        expect(json.results[0].content).toContain('authentication');
    });

    it('returns trigram fallback for substring queries', async () => {
        const proj = getOrCreateProject('/test/search2');
        insertMemory(proj.id, 'websocket connection handling', 'ws', 'fact', 3, '', 'backend');

        const app = makeApp();
        // "socket" won't match word-based (not a prefix of "websocket")
        // but trigram should catch it
        const res = await app.request('/api/search?q=socket&project=/test/search2');
        const json = await res.json() as any;
        expect(json.results.length).toBeGreaterThan(0);
        expect(json.results[0].content).toContain('websocket');
    });

    it('deduplicates results from word and trigram queries', async () => {
        const proj = getOrCreateProject('/test/search3');
        insertMemory(proj.id, 'authentication system design', 'auth', 'solution', 4, '', 'backend');

        const app = makeApp();
        // "authentication" matches both word (exact) and trigram (substring)
        const res = await app.request('/api/search?q=authentication&project=/test/search3');
        const json = await res.json() as any;
        // Should only appear once despite matching both indexes
        const ids = json.results.map((r: any) => r.id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);
    });

    it('returns empty results for missing q parameter', async () => {
        const app = makeApp();
        const res = await app.request('/api/search');
        const json = await res.json() as any;
        expect(json.results).toHaveLength(0);
    });

    it('respects domain filter', async () => {
        const proj = getOrCreateProject('/test/search4');
        insertMemory(proj.id, 'frontend authentication', 'auth', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'backend authentication', 'auth', 'fact', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/search?q=authentication&project=/test/search4&domain=frontend');
        const json = await res.json() as any;
        expect(json.results).toHaveLength(1);
        expect(json.results[0].domain).toBe('frontend');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — 404, endpoint does not exist

- [ ] **Step 3: Implement /api/search**

In `src/app.ts`, add the import for `searchMemoriesFuzzy` from `./db.js`, then add the endpoint. Reuse the existing `STOP_WORDS` hash already defined in the file:

```typescript
    app.get('/api/search', (c) => {
        try {
            const q = c.req.query('q') || '';
            if (!q.trim()) return c.json({ results: [] });

            const project = c.req.query('project');
            const domain = c.req.query('domain');
            const category = c.req.query('category');
            const tag = c.req.query('tag');
            const rawLimit = Number(c.req.query('limit') || '20');
            const limit = rawLimit < 0 ? 20 : rawLimit;

            // Extract and filter words (same logic as /api/recall)
            const words = q
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter((w) => w.length >= 2 && !STOP_WORDS[w]);

            const unique = [...new Set(words)].slice(0, 5);
            if (unique.length === 0) return c.json({ results: [] });

            // 1. Word-based FTS with prefix wildcards (precision)
            const wordQuery = unique.map(w => w + '*').join(' OR ');
            const wordResults = searchMemories(wordQuery, project, tag, category, limit, domain);

            // 2. Trigram fallback for remaining slots (substring matching)
            const seen = new Set<number>(wordResults.map((r: any) => r.id));
            let combined = [...wordResults];

            if (limit === 0 || combined.length < limit) {
                const trigramQuery = unique.join(' OR ');
                const remaining = limit === 0 ? 0 : limit - combined.length;
                const trigramResults = searchMemoriesFuzzy(trigramQuery, project, tag, category, remaining, domain);
                for (const r of trigramResults) {
                    if (!seen.has(r.id)) {
                        seen.add(r.id);
                        combined.push(r);
                    }
                }
            }

            return c.json({ results: combined });
        } catch {
            return c.json({ results: [] });
        }
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: All `/api/search` tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/app.ts test/search.test.ts
git commit -m "feat: add /api/search with dual-index word+trigram search"
```

---

## Chunk 3: Context Injection + Hooks

### Task 7: Domains and categories in startup context

**Files:**
- Modify: `src/context.ts:1,99`
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/search.test.ts`:

```typescript
import { buildStartupContext } from '../src/context.js';

describe('Startup context injection', () => {
    it('includes Available Domains section', () => {
        getOrCreateProject('/test/context');
        const ctx = buildStartupContext('/test/context');
        expect(ctx).toContain('## Available Domains');
        // Should contain at least "general" (seeded default)
        expect(ctx).toContain('general');
    });

    it('includes Available Categories section', () => {
        getOrCreateProject('/test/context');
        const ctx = buildStartupContext('/test/context');
        expect(ctx).toContain('## Available Categories');
        // Should contain at least "fact" (seeded default)
        expect(ctx).toContain('fact');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/search.test.ts`
Expected: FAIL — context does not contain "Available Domains"

- [ ] **Step 3: Add domain/category lists to buildStartupContext()**

In `src/context.ts`, replace the existing import line (line 1):

```typescript
import { listMemories, listTags, getOrCreateProject } from './db.js';
```

with:

```typescript
import { listMemories, listTags, getOrCreateProject, listDomainsRaw, listCategoriesRaw } from './db.js';
```

Then, after the tags section (after line 99, before the tip section at line 101), add:

```typescript
    // Inject full taxonomy for LLM search precision
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context.ts test/search.test.ts
git commit -m "feat: inject domain and category taxonomy into startup context"
```

---

### Task 8: PreToolUse hook + search-context.sh

**Files:**
- Modify: `hooks/hooks.json`
- Create: `hooks/scripts/search-context.sh`

- [ ] **Step 1: Add PreToolUse matcher to hooks.json**

In `hooks/hooks.json`, add a second element to the `PreToolUse` array. The existing array has one object (the `save_memory` dedup-check). Add a comma after it and append:

```json
            {
                "matcher": "mcp__ai-memory__search_memories",
                "hooks": [
                    {
                        "type": "command",
                        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/search-context.sh\"",
                        "timeout": 3
                    }
                ]
            }
```

- [ ] **Step 2: Create search-context.sh**

Create `hooks/scripts/search-context.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse hook: inject taxonomy context before search_memories calls
set -euo pipefail

CONFIG_FILE="$HOME/.ai-memory/config.yaml"
PORT=24636
if [ -f "$CONFIG_FILE" ]; then
    PARSED_PORT=$(grep -A1 '^server:' "$CONFIG_FILE" | grep 'port:' | awk '{print $2}')
    if [ -n "$PARSED_PORT" ]; then
        PORT="$PARSED_PORT"
    fi
fi
BASE="http://localhost:$PORT"

SUMMARY=$(curl -sf "$BASE/api/taxonomy-summary?project=$PWD" 2>/dev/null || true)

if [ -z "$SUMMARY" ]; then
    exit 0
fi

echo "$SUMMARY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
summary = data.get('summary', '')
if not summary:
    sys.exit(0)
output = {'additionalContext': '[ai-memory] Available taxonomy for filtering:\n' + summary}
print(json.dumps(output))
" 2>/dev/null || true

exit 0
```

- [ ] **Step 3: Make script executable**

Run: `chmod +x hooks/scripts/search-context.sh`

- [ ] **Step 4: Commit**

```bash
git add hooks/hooks.json hooks/scripts/search-context.sh
git commit -m "feat: add PreToolUse hook to inject taxonomy before search_memories"
```

---

## Chunk 4: Frontend — Search Bar

### Task 9: Search bar and results view

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Update imports and add search signals**

In `src/ui/App.tsx`, add `createEffect` to the SolidJS import on line 1. Change:

```typescript
import { createSignal, createResource, createMemo, onCleanup, For, Show, type Component } from 'solid-js';
```

to:

```typescript
import { createSignal, createResource, createMemo, createEffect, onCleanup, For, Show, type Component } from 'solid-js';
```

Then add two new signals near the other signal declarations at the top of the `App` component:

```typescript
const [searchQuery, setSearchQuery] = createSignal('');
const [searchResults, setSearchResults] = createSignal<Memory[] | null>(null);
```

- [ ] **Step 2: Add search handler function**

Add inside the `App` component, after the signals:

```typescript
const handleSearch = async (query: string) => {
    if (!query.trim()) {
        setSearchResults(null);
        setSearchQuery('');
        return;
    }
    setSearchQuery(query);
    try {
        const projectParam = project()
            ? `&project=${encodeURIComponent(project())}`
            : '';
        const data = await api<{ results: Memory[] }>(
            `/api/search?q=${encodeURIComponent(query)}${projectParam}`
        );
        setSearchResults(data.results);
    } catch {
        setSearchResults([]);
    }
};

const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
};
```

- [ ] **Step 3: Add search bar UI**

In `src/ui/App.tsx`, inside the `<main>` element (line 484), add the search bar before the existing `<Show>` block:

```tsx
                        {/* Search bar */}
                        <div class="mb-3 relative">
                            <input
                                type="text"
                                placeholder="Search memories..."
                                class="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                                value={searchQuery()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSearch(e.currentTarget.value);
                                }}
                            />
                            <Show when={searchResults() !== null}>
                                <button
                                    class="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 text-xs"
                                    onClick={clearSearch}
                                    title="Clear search"
                                >
                                    <Icon name="xmark" size={14} />
                                </button>
                            </Show>
                        </div>
```

- [ ] **Step 4: Add search results rendering**

Wrap the existing `<Show>` block (the grouped memories view) in a conditional. Replace the existing `<Show when={(memories()?.length ?? 0) > 0} ...>` block with:

```tsx
                        <Show when={searchResults() !== null} fallback={
                            {/* Existing grouped memories view — move the entire existing <Show> block here as the fallback */}
                            <Show
                                when={(memories()?.length ?? 0) > 0}
                                fallback={<div class="text-neutral-500 text-xs text-center py-8 flex flex-col items-center gap-2"><Icon name="brain" size={24} /><span>No memories yet</span></div>}
                            >
                                {/* ... entire existing grouped rendering ... */}
                            </Show>
                        }>
                            {/* Search results flat view */}
                            <div class="text-xs text-neutral-500 mb-2">
                                {searchResults()!.length} result{searchResults()!.length !== 1 ? 's' : ''} for '{searchQuery()}'
                            </div>
                            <Show when={searchResults()!.length > 0} fallback={
                                <div class="text-neutral-500 text-xs text-center py-8">No matches found</div>
                            }>
                                <div class="flex flex-wrap gap-3">
                                    <For each={searchResults()!}>
                                        {(m) => (
                                            <MemoryCard
                                                memory={m}
                                                onDelete={(id) => setDeleteTarget({ type: 'memories', id })}
                                                domainIcon={domainIconMap()[m.domain || ''] || 'fa-folder'}
                                                categoryIcon={categoryIconMap()[m.category] || 'fa-bookmark'}
                                            />
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </Show>
```

- [ ] **Step 5: Clear search on project change**

Add a `createEffect` to clear search when the selected project changes:

```typescript
createEffect(() => {
    project(); // track dependency
    clearSearch();
});
```

Place this near the other effects in the component.

- [ ] **Step 6: Build and verify**

Run: `pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 7: Visual verification**

Start the dev server: `pnpm dev:ui`

Open http://localhost:5173 (or the Vite dev port) and verify:
- Search bar appears at the top of the memory panel
- Typing a query and pressing Enter shows results
- Results header shows count and query text
- Clear button (x icon) appears when search is active
- Clicking clear restores the grouped view
- Changing projects clears the search

- [ ] **Step 8: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: add search bar with dual-index word+trigram results"
```

---

## Final Verification

- [ ] **Run full test suite**

Run: `pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Build**

Run: `pnpm build`
Expected: No errors

- [ ] **End-to-end checks**

1. Start server: `pnpm start`
2. Open dashboard at http://localhost:24636
3. Verify search bar works with both word matches and substring matches
4. Start a new Claude session — verify "Available Domains" and "Available Categories" appear in startup context
5. Use `search_memories` MCP tool — verify PreToolUse hook injects taxonomy
