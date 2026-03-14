# Bug Fix Batch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 dashboard bugs: domain validation on save, real stats counts, project rendering for empty projects, and dropdown refresh on new project creation.

**Architecture:** Targeted fixes across db layer (validation + stats query), HTTP routes (stats endpoint + SSE broadcast), and SolidJS UI (stats resource + project merging). No refactoring.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Hono, SolidJS, Vitest

---

## Chunk 1: Backend Fixes

### Task 1: Domain validation in insertMemory/updateMemory

**Files:**
- Modify: `src/db.ts:296-341` (insertMemory + updateMemory)
- Test: `test/db.test.ts`

- [ ] **Step 1: Write failing test for domain validation**

In `test/db.test.ts`, add to the `memories` describe block:

```typescript
it('insertMemory rejects invalid domain', () => {
    const proj = getOrCreateProject('/test/dom-val');
    expect(() => insertMemory(proj.id, 'test', '', 'fact', 3, '', 'nonexistent-domain')).toThrow('Invalid domain');
});

it('insertMemory accepts valid domain', () => {
    const proj = getOrCreateProject('/test/dom-val2');
    const id = insertMemory(proj.id, 'test', '', 'fact', 3, '', 'frontend');
    expect(id).toBeGreaterThan(0);
});

it('insertMemory accepts undefined domain (null in DB)', () => {
    const proj = getOrCreateProject('/test/dom-val3');
    const id = insertMemory(proj.id, 'test', '', 'fact', 3, '', undefined);
    expect(id).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/db.test.ts`
Expected: First test FAILS (no domain validation exists yet), others pass.

- [ ] **Step 3: Add domain validation to insertMemory**

In `src/db.ts`, inside `insertMemory()`, after the category validation block (lines 306-309), add:

```typescript
if (domain) {
    const validDoms = listDomainsRaw();
    if (!validDoms.some(d => d.name === domain)) {
        throw new Error(`Invalid domain: "${domain}". Valid: ${validDoms.map(d => d.name).join(', ')}`);
    }
}
```

- [ ] **Step 4: Add same domain validation to updateMemory**

In `src/db.ts`, inside `updateMemory()`, after the category validation block (lines 331-334), add the same domain validation block.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/db.test.ts`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add src/db.ts test/db.test.ts
git commit -m "fix: add domain validation to insertMemory and updateMemory"
```

### Task 2: Make domain required with default in MCP save_memory tool

**Files:**
- Modify: `src/tools.ts:37` (save_memory schema)

- [ ] **Step 1: Change domain from optional to required with default**

In `src/tools.ts`, line 37, change:

```typescript
domain: z.string().optional().describe('Domain (e.g., frontend, backend, data). See list_domains for options.'),
```

to:

```typescript
domain: z.string().default('general').describe('Domain (e.g., frontend, backend, data). See list_domains for options.'),
```

- [ ] **Step 2: Verify build succeeds**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/tools.ts
git commit -m "fix: make domain required with default 'general' in save_memory MCP tool"
```

### Task 3: Add getStats function and /api/stats endpoint

**Files:**
- Modify: `src/db.ts` (add getStats export)
- Modify: `src/app.ts` (add /api/stats route)
- Test: `test/db.test.ts` and `test/api.test.ts`

- [ ] **Step 1: Write failing test for getStats in db.test.ts**

Add a new describe block at the end of `test/db.test.ts`:

```typescript
describe('getStats', () => {
    it('returns total counts across all projects', () => {
        const p1 = getOrCreateProject('/test/stats1');
        const p2 = getOrCreateProject('/test/stats2');
        insertMemory(p1.id, 'mem1', '', 'fact', 3, '');
        insertMemory(p1.id, 'mem2', '', 'fact', 3, '');
        insertMemory(p2.id, 'mem3', '', 'fact', 3, '');
        insertObservation(p1.id, 'obs1', 'src');

        const stats = getStats();
        expect(stats.memories).toBe(3);
        expect(stats.observations).toBe(1);
    });

    it('returns project-scoped counts', () => {
        const p1 = getOrCreateProject('/test/stats-scoped1');
        const p2 = getOrCreateProject('/test/stats-scoped2');
        insertMemory(p1.id, 'mem1', '', 'fact', 3, '');
        insertMemory(p2.id, 'mem2', '', 'fact', 3, '');
        insertObservation(p1.id, 'obs1', 'src');
        insertObservation(p2.id, 'obs2', 'src');

        const stats = getStats('/test/stats-scoped1');
        expect(stats.memories).toBe(1);
        expect(stats.observations).toBe(1);
    });
});
```

Update the import at the top of `test/db.test.ts` to include `getStats` and `insertObservation`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/db.test.ts`
Expected: FAIL — `getStats` is not exported.

- [ ] **Step 3: Implement getStats in db.ts**

Add at the end of the "Memory queries" section in `src/db.ts` (before the Domain queries section):

```typescript
export function getStats(projectPath?: string): { memories: number; observations: number } {
    const db = getDb();

    if (projectPath) {
        const row = db.prepare(`
            SELECT
                (SELECT COUNT(*) FROM memories m JOIN projects p ON m.project_id = p.id WHERE p.path = ? OR p.path = '_global') as memories,
                (SELECT COUNT(*) FROM observations o JOIN projects p ON o.project_id = p.id WHERE p.path = ? OR p.path = '_global') as observations
        `).get(projectPath, projectPath) as any;
        return { memories: row.memories, observations: row.observations };
    }

    const row = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM memories) as memories,
            (SELECT COUNT(*) FROM observations) as observations
    `).get() as any;
    return { memories: row.memories, observations: row.observations };
}
```

- [ ] **Step 4: Run db tests to verify they pass**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/db.test.ts`
Expected: ALL pass.

- [ ] **Step 5: Write failing test for /api/stats endpoint**

Add to `test/api.test.ts` inside the `API` describe block:

```typescript
it('GET /api/stats returns total counts', async () => {
    const app = makeApp();
    const proj = getOrCreateProject('_global');
    insertMemory(proj.id, 'test memory', '', 'fact', 3, '');
    insertObservation(proj.id, 'test obs', 'src');

    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.memories).toBe(1);
    expect(json.observations).toBe(1);
});

it('GET /api/stats?project=X returns scoped counts', async () => {
    const app = makeApp();
    const p1 = getOrCreateProject('/proj/a');
    const p2 = getOrCreateProject('/proj/b');
    insertMemory(p1.id, 'mem1', '', 'fact', 3, '');
    insertMemory(p2.id, 'mem2', '', 'fact', 3, '');

    const res = await app.request('/api/stats?project=%2Fproj%2Fa');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.memories).toBe(1);
});
```

Update the import in `test/api.test.ts` to include `insertMemory`.

- [ ] **Step 6: Run api tests to verify they fail**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/api.test.ts`
Expected: FAIL — 404 on /api/stats.

- [ ] **Step 7: Add /api/stats route in app.ts**

In `src/app.ts`, add the import for `getStats` from `./db.js`, then add this route after the `/api/projects` route (around line 99):

```typescript
app.get('/api/stats', (c) => {
    const project = c.req.query('project');
    return c.json(getStats(project));
});
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL pass.

- [ ] **Step 9: Commit**

```bash
git add src/db.ts src/app.ts test/db.test.ts test/api.test.ts
git commit -m "fix: add /api/stats endpoint with real COUNT(*) totals"
```

### Task 4: Broadcast SSE event when new project created via /enqueue

**Files:**
- Modify: `src/app.ts:78-85` (/enqueue handler)

- [ ] **Step 1: Modify /enqueue to detect new project creation**

In `src/app.ts`, change the `/enqueue` handler from:

```typescript
app.post('/enqueue', async (c) => {
    const body = await c.req.json();
    const projectPath = body.project || '_global';
    const project = getOrCreateProject(projectPath);
    const id = enqueueObservation(project.id, JSON.stringify(body.payload || body));
    log('api', `Enqueued turn for ${projectPath}`);
    return c.json({ queued: true, id });
});
```

to:

```typescript
app.post('/enqueue', async (c) => {
    const body = await c.req.json();
    const projectPath = body.project || '_global';
    const isNew = !listProjects().some(p => p.path === projectPath);
    const project = getOrCreateProject(projectPath);
    const id = enqueueObservation(project.id, JSON.stringify(body.payload || body));
    log('api', `Enqueued turn for ${projectPath}`);
    if (isNew) broadcast('counts:updated', {});
    return c.json({ queued: true, id });
});
```

Note: `listProjects` and `broadcast` are already imported in app.ts.

- [ ] **Step 2: Verify build succeeds**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "fix: broadcast SSE event when new project created via /enqueue"
```

## Chunk 2: Frontend Fixes

### Task 5: Use stats resource for header counts

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Add stats resource**

In `src/ui/App.tsx`, after the `observations` resource (around line 234), add:

```typescript
const [stats] = createResource(
    () => ({ project: project(), key: refreshKey() }),
    ({ project: p }) => {
        const qs = p ? `?project=${encodeURIComponent(p)}` : '';
        return api<{ memories: number; observations: number }>('/api/stats' + qs);
    },
);
```

- [ ] **Step 2: Replace header stat displays with stats resource**

In the header stats section (around lines 322-331), change:

```tsx
<span class="text-sky-300/70 flex items-center gap-1">
    <Icon name="brain" size={12} />
    {memories()?.length ?? 0} memories
</span>
<span class="text-purple-300/70 flex items-center gap-1">
    <Icon name="eye" size={12} />
    {observations()?.length ?? 0} observations
</span>
```

to:

```tsx
<span class="text-sky-300/70 flex items-center gap-1">
    <Icon name="brain" size={12} />
    {stats()?.memories ?? 0} memories
</span>
<span class="text-purple-300/70 flex items-center gap-1">
    <Icon name="eye" size={12} />
    {stats()?.observations ?? 0} observations
</span>
```

- [ ] **Step 3: Also update the observations sidebar count**

In the observations sidebar header (around line 408), change:

```tsx
<span class="text-xs text-purple-300/70">({observations()?.length ?? 0})</span>
```

to:

```tsx
<span class="text-xs text-purple-300/70">({stats()?.observations ?? 0})</span>
```

- [ ] **Step 4: Build and verify**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx
git commit -m "fix: use /api/stats for real count totals in header"
```

### Task 6: Merge empty projects into groupedMemories

**Files:**
- Modify: `src/ui/App.tsx` (groupedMemories memo)

- [ ] **Step 1: Modify groupedMemories to include all projects**

In `src/ui/App.tsx`, in the `groupedMemories` memo (around line 260), after the existing loop that builds `result` from `projectMap` and before `return result;`, add:

```typescript
// Merge projects that have 0 memories so they still render
if (isAllProjects) {
    const existingPaths: Record<string, true> = {};
    for (const g of result) existingPaths[g.project] = true;
    for (const p of (projects() || [])) {
        if (!existingPaths[p.path]) {
            result.push({ project: p.path, domains: [] });
        }
    }
}
```

This inserts after the `for (const proj of Object.keys(projectMap).sort())` loop ends and before the `return result;` statement.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/App.tsx
git commit -m "fix: render projects with 0 memories on main page"
```

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL pass.

- [ ] **Step 2: Build production bundle**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Build succeeds with no errors.
