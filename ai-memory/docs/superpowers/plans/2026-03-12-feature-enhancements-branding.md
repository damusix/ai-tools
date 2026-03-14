# Feature Enhancements + Branding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add domain stats, domain/category filtering, improved FTS search with UI, taxonomy-aware hooks, and brain+sparkles branding to the ai-memory dashboard.

**Architecture:** Backend changes add trigram FTS index, search/taxonomy endpoints, and limit=0 support. Frontend adds search bar, filter state, domain counts, and branding. Hooks inject taxonomy context before search_memories calls. Context injection expanded with full domain/category lists.

**Tech Stack:** TypeScript, SolidJS, Hono, SQLite FTS5 (word + trigram), better-sqlite3, Vitest, Tailwind CSS

---

## Chunk 1: Backend — Search, Stats, Limits

### Task 1: Support limit=0 (unlimited) in listMemories/searchMemories + raise MCP default

**Files:**
- Modify: `src/db.ts:389-393` (searchMemories LIMIT clause)
- Modify: `src/db.ts:417-428` (listMemories LIMIT clause)
- Modify: `src/tools.ts:105` (list_memories default limit)
- Test: `test/db.test.ts`

- [ ] **Step 1: Write failing test for limit=0**

Add to the `memories` describe block in `test/db.test.ts`:

```typescript
it('listMemories with limit=0 returns all results', () => {
    const proj = getOrCreateProject('/test/limit-zero');
    for (let i = 0; i < 5; i++) {
        insertMemory(proj.id, `mem-${i}`, '', 'fact', 3, '');
    }
    const all = listMemories('/test/limit-zero', undefined, undefined, 0);
    expect(all.length).toBe(5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/db.test.ts` (from `/Users/alonso/projects/claude-marketplace/ai-memory`)
Expected: FAIL — limit=0 causes `LIMIT 0` which returns 0 rows.

- [ ] **Step 3: Implement limit=0 support in listMemories**

In `src/db.ts`, replace lines 417-428 (the sql + limit portion of `listMemories`):

```typescript
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain, m.created_at, m.updated_at, m.reason, p.path as project_path
        FROM memories m
        JOIN projects p ON m.project_id = p.id
        ${where}
        ORDER BY m.importance DESC, m.created_at DESC
    `;
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
```

- [ ] **Step 4: Implement limit=0 support in searchMemories**

In `src/db.ts`, replace lines 389-392 (the ORDER BY + LIMIT portion of `searchMemories`):

```typescript
    sql += ' ORDER BY m.importance DESC, m.created_at DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
```

- [ ] **Step 5: Raise MCP list_memories default**

In `src/tools.ts`, line 105, change:

```typescript
limit: z.number().default(50),
```

to:

```typescript
limit: z.number().default(500).describe('Max results. Use 0 for unlimited.'),
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run test/db.test.ts`
Expected: ALL pass.

- [ ] **Step 7: Commit**

```
git add src/db.ts src/tools.ts test/db.test.ts
git commit -m "feat: support limit=0 (unlimited) in listMemories/searchMemories, raise MCP default to 500"
```

---

### Task 2: FTS prefix wildcards in /api/recall

**Files:**
- Modify: `src/app.ts:316`

- [ ] **Step 1: Add prefix wildcards**

In `src/app.ts`, line 316, change:

```typescript
const ftsQuery = unique.join(' OR ');
```

to:

```typescript
const ftsQuery = unique.map(w => w.endsWith('*') ? w : w + '*').join(' OR ');
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run test/api.test.ts`
Expected: ALL pass (existing recall tests still work — prefix wildcards are a superset).

- [ ] **Step 3: Commit**

```
git add src/app.ts
git commit -m "feat: add FTS5 prefix wildcards to /api/recall for better search recall"
```

---

### Task 3: Trigram FTS table + migration

**Files:**
- Modify: `src/db.ts` (initSchema, after line 136)
- Test: `test/db.test.ts`

- [ ] **Step 1: Write failing test for trigram substring search**

Add a new describe block in `test/db.test.ts`:

```typescript
describe('trigram search', () => {
    it('searchMemoriesFuzzy finds substring matches', () => {
        const proj = getOrCreateProject('/test/trigram');
        insertMemory(proj.id, 'Always use authentication middleware for API routes', 'auth,security', 'pattern', 4, '');

        const results = searchMemoriesFuzzy('auth');
        expect(results.length).toBe(1);
        expect(results[0].content).toContain('authentication');
    });

    it('searchMemoriesFuzzy finds partial word matches', () => {
        const proj = getOrCreateProject('/test/trigram2');
        insertMemory(proj.id, 'Use webpack for bundling the frontend assets', 'webpack', 'fact', 3, '');

        const results = searchMemoriesFuzzy('webpac');
        expect(results.length).toBe(1);
    });
});
```

Add `searchMemoriesFuzzy` to the imports at top of test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/db.test.ts`
Expected: FAIL — `searchMemoriesFuzzy` is not exported.

- [ ] **Step 3: Add trigram FTS table and triggers to initSchema**

In `src/db.ts`, inside the `db.exec(...)` block in `initSchema()`, after the existing FTS triggers for memories (after line 136), add:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memories_trigram
    USING fts5(content, tags, tokenize="trigram");

CREATE TRIGGER IF NOT EXISTS memories_trigram_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_trigram_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_trigram(memories_trigram, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_trigram_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_trigram(memories_trigram, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
    INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
```

- [ ] **Step 4: Add backfill after schema init**

In `src/db.ts`, after the `initSchema` function's `db.exec(...)` block but still inside `initSchema()` (after the seed inserts around line 191), add:

```typescript
// Backfill trigram FTS from existing memories (idempotent)
const trigramCount = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
if (trigramCount < memoryCount) {
    db.exec('DELETE FROM memories_trigram');
    db.exec('INSERT INTO memories_trigram(rowid, content, tags) SELECT id, content, tags FROM memories');
}
```

- [ ] **Step 5: Add searchMemoriesFuzzy function**

In `src/db.ts`, after the `searchMemories()` function (after line 393), add:

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
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain, m.created_at, m.updated_at, m.reason, p.path as project_path
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
    sql += ' ORDER BY m.importance DESC, m.created_at DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run test/db.test.ts`
Expected: ALL pass including new trigram tests.

- [ ] **Step 7: Commit**

```
git add src/db.ts test/db.test.ts
git commit -m "feat: add trigram FTS5 table for substring search with backfill and triggers"
```

---

### Task 4: Search endpoint (/api/search)

**Files:**
- Modify: `src/app.ts` (add route, import searchMemoriesFuzzy)
- Test: `test/api.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `API` describe block in `test/api.test.ts`. Add `searchMemoriesFuzzy` is not needed in test imports — we test via HTTP.

```typescript
it('GET /api/search returns word-based + trigram results', async () => {
    const app = makeApp();
    const proj = getOrCreateProject('_global');
    insertMemory(proj.id, 'Use authentication middleware for all API routes', 'auth', 'pattern', 4, '');
    insertMemory(proj.id, 'Configure webpack bundler for production builds', 'webpack', 'fact', 3, '');

    const res = await app.request('/api/search?q=auth');
    expect(res.status).toBe(200);
    const json: any[] = await res.json();
    expect(json.length).toBeGreaterThan(0);
    expect(json[0].content).toContain('authentication');
});

it('GET /api/search without q returns 400', async () => {
    const app = makeApp();
    const res = await app.request('/api/search');
    expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/api.test.ts`
Expected: FAIL — 404 on /api/search.

- [ ] **Step 3: Add /api/search route**

In `src/app.ts`, add `searchMemoriesFuzzy` to the import from `./db.js` (line 7-33). Then add this route after the `/api/recall` endpoint (after line 322):

```typescript
app.get('/api/search', (c) => {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'q parameter required' }, 400);
    const project = c.req.query('project');
    const domain = c.req.query('domain');
    const category = c.req.query('category');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    // Word-based FTS with prefix wildcards
    const words = q.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0);
    const ftsTerms = [...new Set(words)].slice(0, 5);
    let results: any[] = [];

    if (ftsTerms.length > 0) {
        const ftsQuery = ftsTerms.map(w => w.endsWith('*') ? w : w + '*').join(' OR ');
        try {
            results = searchMemories(ftsQuery, project, undefined, category, limit, domain);
        } catch {}
    }

    // Fill with trigram if not enough results
    if (results.length < limit) {
        try {
            const fuzzy = searchMemoriesFuzzy(q, project, undefined, category, limit - results.length, domain);
            const seen: Record<number, true> = {};
            for (const r of results) seen[r.id] = true;
            for (const r of fuzzy) {
                if (!seen[r.id]) {
                    results.push(r);
                    seen[r.id] = true;
                }
            }
        } catch {}
    }

    return c.json(results);
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/api.test.ts`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```
git add src/app.ts test/api.test.ts
git commit -m "feat: add /api/search endpoint with dual word+trigram FTS"
```

---

### Task 5: Taxonomy summary endpoint + expand SessionStart context

**Files:**
- Modify: `src/app.ts` (add route, add listTags import)
- Modify: `src/context.ts:1,99` (add imports, add domain/category sections)
- Test: `test/api.test.ts`

- [ ] **Step 1: Write failing test for /api/taxonomy-summary**

Add to `API` describe block in `test/api.test.ts`:

```typescript
it('GET /api/taxonomy-summary returns domain/category/tag summary', async () => {
    const app = makeApp();
    const proj = getOrCreateProject('_global');
    insertMemory(proj.id, 'test memory', 'typescript', 'fact', 3, '', 'frontend');

    const res = await app.request('/api/taxonomy-summary');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toContain('frontend');
    expect(json.summary).toContain('fact');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/api.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Add /api/taxonomy-summary route**

In `src/app.ts`, add `listTags` to the import from `./db.js`. Then add this route after the `/api/search` route:

```typescript
app.get('/api/taxonomy-summary', (c) => {
    const project = c.req.query('project');
    const domains = listDomains(project);
    const categories = listCategories(project);
    const tags = listTags(project);

    const domainStr = domains.filter(d => d.count > 0).map(d => `${d.name}(${d.count})`).join(', ');
    const categoryStr = categories.filter(c => c.count > 0).map(c => `${c.name}(${c.count})`).join(', ');
    const tagStr = tags.slice(0, 20).map(t => `${t.tag}(${t.count})`).join(', ');

    const summary = `Domains: ${domainStr || 'none'}\nCategories: ${categoryStr || 'none'}\nTop tags: ${tagStr || 'none'}`;
    return c.json({ summary });
});
```

- [ ] **Step 4: Expand SessionStart context with domains and categories**

In `src/context.ts`, add `listDomainsRaw` and `listCategoriesRaw` to the import on line 1:

```typescript
import { listMemories, listTags, getOrCreateProject, listDomainsRaw, listCategoriesRaw } from './db.js';
```

Then after the tags section (after line 99, before the tip section at line 102), add:

```typescript
// Add available domains and categories for LLM search vocabulary
const allDomains = listDomainsRaw();
if (allDomains.length > 0) {
    lines.push(`\n## Available Domains\n${allDomains.map(d => d.name).join(', ')}`);
}

const allCategories = listCategoriesRaw();
if (allCategories.length > 0) {
    lines.push(`\n## Available Categories\n${allCategories.map(c => `${c.name}: ${c.description}`).join('\n')}`);
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run test/`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```
git add src/app.ts src/context.ts test/api.test.ts
git commit -m "feat: add /api/taxonomy-summary endpoint, expand SessionStart context with domains/categories"
```

---

### Task 6: PreToolUse hook for search_memories

**Files:**
- Modify: `hooks/hooks.json:39-50` (add to PreToolUse array)
- Create: `hooks/scripts/search-context.sh`

- [ ] **Step 1: Add hook entry to hooks.json**

In `hooks/hooks.json`, the `PreToolUse` key (line 39) currently has one array entry. Add a second entry to the array:

```json
"PreToolUse": [
    {
        "matcher": "mcp__ai-memory__save_memory",
        "hooks": [
            {
                "type": "command",
                "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/dedup-check.sh\"",
                "timeout": 3
            }
        ]
    },
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
]
```

- [ ] **Step 2: Create search-context.sh**

Create `hooks/scripts/search-context.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse hook: inject taxonomy context before search_memories
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

SUMMARY=$(curl -sf --max-time 2 "$BASE/api/taxonomy-summary?project=$PWD" 2>/dev/null || true)

if [ -n "$SUMMARY" ]; then
    echo "$SUMMARY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
summary = data.get('summary', '')
if summary:
    print(json.dumps({'additionalContext': '[ai-memory] Available taxonomy for filtering:\n' + summary + '\nUse these domain, category, and tag values to narrow your search.'}))
" 2>/dev/null || true
fi

exit 0
```

- [ ] **Step 3: Make script executable**

```
chmod +x hooks/scripts/search-context.sh
```

- [ ] **Step 4: Commit**

```
git add hooks/hooks.json hooks/scripts/search-context.sh
git commit -m "feat: add PreToolUse hook injecting taxonomy context before search_memories"
```

---

## Chunk 2: Frontend — Stats, Filters, Search Bar

### Task 7: Domain stats in header bars

**Files:**
- Modify: `src/ui/App.tsx:544`

- [ ] **Step 1: Add count to domain header**

In `src/ui/App.tsx`, line 544, change:

```tsx
{domGroup.domain}
```

to:

```tsx
{domGroup.domain}
<span class="text-neutral-600 font-normal">({domGroup.categories.reduce((n, cat) => n + cat.memories.length, 0)})</span>
```

- [ ] **Step 2: Build and verify**

Run: `pnpm build` (from `/Users/alonso/projects/claude-marketplace/ai-memory`)
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```
git add src/ui/App.tsx
git commit -m "feat: show memory count in domain header bars"
```

---

### Task 8: Domain/category filter UI

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Add filter signal**

In `src/ui/App.tsx`, after the existing signals (around line 77), add:

```typescript
const [filter, setFilter] = createSignal<{ domain?: string; category?: string } | null>(null);
```

- [ ] **Step 2: Modify memories resource to use filter**

In `src/ui/App.tsx`, modify the memories resource (lines 220-226) to include filter params:

```typescript
const [memories] = createResource(
    () => ({ project: project(), key: refreshKey(), filter: filter() }),
    ({ project: p, filter: f }) => {
        const params = new URLSearchParams();
        if (p) params.set('project', p);
        if (f?.domain) params.set('domain', f.domain);
        if (f?.category) params.set('category', f.category);
        params.set('limit', f ? '500' : '100');
        return api<Memory[]>('/api/memories?' + params.toString());
    },
);
```

- [ ] **Step 3: Clear filter on project change**

After the `selectProject` function (around line 103), add:

```typescript
const clearFilter = () => setFilter(null);
```

And in the `selectProject` function, add `setFilter(null)` after `setProject(path)`:

```typescript
const selectProject = (path: string) => {
    setProject(path);
    setFilter(null);
    if (path) {
        localStorage.setItem(STORAGE_KEY, path);
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
};
```

- [ ] **Step 4: Add filter bar above memories**

In `src/ui/App.tsx`, at the top of the `<main>` element (after line 484, before the `<Show>` that renders memories), add:

```tsx
<Show when={filter()}>
    <div class="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
        <Icon name="sliders" size={14} class="text-sky-400" />
        <span class="text-xs text-sky-300">
            Filtering: <span class="font-semibold">{filter()!.domain}</span>
            <Show when={filter()!.category}>
                {' > '}<span class="font-semibold">{filter()!.category}</span>
            </Show>
        </span>
        <button
            onClick={clearFilter}
            class="ml-auto text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
        >
            <Icon name="x" size={12} /> Clear
        </button>
    </div>
</Show>
```

- [ ] **Step 5: Add filter buttons to domain headers**

In the domain header button (around line 538-547), add a filter button between the domain name span and the chevron. Replace the entire domain `<button>` content:

```tsx
<button
    class="w-full flex items-center justify-between py-2 px-3 text-sm font-semibold text-neutral-200 hover:bg-neutral-800/60 transition-colors group/dom"
    onClick={() => toggleDomain(domKey)}
>
    <span class="capitalize flex items-center gap-1.5">
        <i class={`fa-solid ${domainIconMap()[domGroup.domain] || 'fa-folder'}`} style="font-size: 14px"></i>
        {domGroup.domain}
        <span class="text-neutral-600 font-normal">({domGroup.categories.reduce((n, cat) => n + cat.memories.length, 0)})</span>
    </span>
    <span class="flex items-center gap-1">
        <button
            onClick={(e) => { e.stopPropagation(); setFilter({ domain: domGroup.domain }); }}
            class="p-1 rounded text-neutral-600 hover:text-sky-400 hover:bg-sky-400/10 opacity-0 group-hover/dom:opacity-100 transition-opacity"
            title={`Filter by ${domGroup.domain}`}
        >
            <Icon name="sliders" size={12} />
        </button>
        <Icon name={collapsedDomains()[domKey] ? 'chevron-right' : 'chevron-down'} size={12} class="text-neutral-500" />
    </span>
</button>
```

- [ ] **Step 6: Add filter buttons to category headers**

In the category header button (around line 556-566), add a similar filter button. Update the button content:

```tsx
<button
    class="w-full flex items-center justify-between py-2 px-3 text-xs font-medium text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50 group/cat"
    onClick={() => toggleCategory(catKey)}
>
    <span class="capitalize flex items-center gap-1.5">
        <i class={`fa-solid ${categoryIconMap()[catGroup.category] || 'fa-bookmark'}`} style="font-size: 12px"></i>
        {catGroup.category}
        <span class="text-neutral-600 font-normal">({catGroup.memories.length})</span>
    </span>
    <span class="flex items-center gap-1">
        <button
            onClick={(e) => { e.stopPropagation(); setFilter({ domain: domGroup.domain, category: catGroup.category }); }}
            class="p-1 rounded text-neutral-600 hover:text-sky-400 hover:bg-sky-400/10 opacity-0 group-hover/cat:opacity-100 transition-opacity"
            title={`Filter by ${domGroup.domain} > ${catGroup.category}`}
        >
            <Icon name="sliders" size={10} />
        </button>
        <Icon name={collapsedCategories()[catKey] ? 'chevron-right' : 'chevron-down'} size={10} class="text-neutral-600" />
    </span>
</button>
```

- [ ] **Step 7: Build and verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```
git add src/ui/App.tsx
git commit -m "feat: add clickable domain/category filter with filter bar UI"
```

---

### Task 9: Search bar UI

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Add search signals**

In `src/ui/App.tsx`, after the filter signal, add:

```typescript
const [searchQuery, setSearchQuery] = createSignal('');
const [searchResults, setSearchResults] = createSignal<Memory[] | null>(null);
```

- [ ] **Step 2: Add search handler**

After the `clearFilter` function, add:

```typescript
const handleSearch = async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return; }
    const params = new URLSearchParams({ q });
    if (project()) params.set('project', project());
    const results = await api<Memory[]>('/api/search?' + params.toString());
    setSearchResults(results);
};

const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
};
```

- [ ] **Step 3: Add search bar at top of main panel**

In `src/ui/App.tsx`, at the very top of the `<main>` element (after line 484, before the filter bar), add:

```tsx
<div class="mb-3 flex gap-2">
    <div class="flex-1 relative">
        <input
            type="text"
            placeholder="Search memories..."
            class="w-full px-3 py-1.5 text-sm bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-sky-500"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery())}
        />
    </div>
    <Show when={searchResults()}>
        <button
            onClick={clearSearch}
            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-400 flex items-center gap-1"
        >
            <Icon name="x" size={12} /> Clear
        </button>
    </Show>
</div>
```

- [ ] **Step 4: Render search results when active**

Wrap the existing grouped memories view in a conditional. After the search bar and filter bar, replace the existing `<Show when={(memories()?.length ?? 0) > 0}>` block (the entire memories rendering section) with:

```tsx
<Show when={searchResults()} fallback={
    /* existing grouped memories rendering — the entire <Show when={(memories()?.length ...}> block */
}>
    <div>
        <h3 class="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
            <Icon name="brain" size={14} class="text-sky-400" />
            Search Results
            <span class="text-xs text-neutral-500">({searchResults()!.length})</span>
        </h3>
        <Show when={searchResults()!.length > 0} fallback={
            <div class="text-neutral-500 text-xs text-center py-8">No results found</div>
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
    </div>
</Show>
```

- [ ] **Step 5: Build and verify**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```
git add src/ui/App.tsx
git commit -m "feat: add search bar UI with dual FTS word+trigram search"
```

---

## Chunk 3: Branding

### Task 10: BrandLogo component

**Files:**
- Create: `src/ui/components/BrandLogo.tsx`
- Modify: `src/ui/App.tsx:319,337-338`

- [ ] **Step 1: Create BrandLogo component**

Create `src/ui/components/BrandLogo.tsx`:

```tsx
import { type Component } from 'solid-js';

const BrandLogo: Component<{ size?: number; class?: string }> = (props) => {
    const size = () => props.size ?? 24;
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 640"
            width={size()}
            height={size()}
            class={props.class ?? ''}
        >
            <path fill="#38bdf8" d="M184 120C184 89.1 209.1 64 240 64L296 64L296 576L232 576C202.2 576 177.1 555.6 170 528C169.3 528 168.7 528 168 528C123.8 528 88 492.2 88 448C88 430 94 413.4 104 400C84.6 385.4 72 362.2 72 336C72 305.1 89.6 278.2 115.2 264.9C108.1 252.9 104 238.9 104 224C104 179.8 139.8 144 184 144L184 120zM456 120L456 144C500.2 144 536 179.8 536 224C536 239 531.9 253 524.8 264.9C550.5 278.2 568 305 568 336C568 362.2 555.4 385.4 536 400C546 413.4 552 430 552 448C552 492.2 516.2 528 472 528C471.3 528 470.7 528 470 528C462.9 555.6 437.8 576 408 576L344 576L344 64L400 64C430.9 64 456 89.1 456 120z"/>
            <path fill="#fbbf24" d="M480 96L512 24L544 96L616 128L544 160L512 232L480 160L408 128L480 96zM160 256L224 112L288 256L432 320L288 384L224 528L160 384L16 320L160 256zM480 408L512 480L584 512L512 544L480 616L448 544L376 512L448 480L480 408z"/>
        </svg>
    );
};

export default BrandLogo;
```

- [ ] **Step 2: Replace brain icon in App.tsx header**

In `src/ui/App.tsx`, add import at top:

```typescript
import BrandLogo from './components/BrandLogo';
```

Then replace line 337-338:

```tsx
<Icon name="brain" size={20} class="text-sky-400" />
```

with:

```tsx
<BrandLogo size={20} />
```

- [ ] **Step 3: Build and verify**

Run: `pnpm build`
Expected: Build succeeds. Header shows blue brain with yellow sparkles.

- [ ] **Step 4: Commit**

```
git add src/ui/components/BrandLogo.tsx src/ui/App.tsx
git commit -m "feat: add brain+sparkles branding logo component"
```

---

### Task 11: Favicon

**Files:**
- Modify: `src/ui/index.html`

- [ ] **Step 1: Add inline SVG favicon**

In `src/ui/index.html`, inside `<head>`, add:

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'%3E%3Cpath fill='%2338bdf8' d='M184 120C184 89.1 209.1 64 240 64L296 64L296 576L232 576C202.2 576 177.1 555.6 170 528C169.3 528 168.7 528 168 528C123.8 528 88 492.2 88 448C88 430 94 413.4 104 400C84.6 385.4 72 362.2 72 336C72 305.1 89.6 278.2 115.2 264.9C108.1 252.9 104 238.9 104 224C104 179.8 139.8 144 184 144L184 120zM456 120L456 144C500.2 144 536 179.8 536 224C536 239 531.9 253 524.8 264.9C550.5 278.2 568 305 568 336C568 362.2 555.4 385.4 536 400C546 413.4 552 430 552 448C552 492.2 516.2 528 472 528C471.3 528 470.7 528 470 528C462.9 555.6 437.8 576 408 576L344 576L344 64L400 64C430.9 64 456 89.1 456 120z'/%3E%3Cpath fill='%23fbbf24' d='M480 96L512 24L544 96L616 128L544 160L512 232L480 160L408 128L480 96zM160 256L224 112L288 256L432 320L288 384L224 528L160 384L16 320L160 256zM480 408L512 480L584 512L512 544L480 616L448 544L376 512L448 480L480 408z'/%3E%3C/svg%3E" />
```

- [ ] **Step 2: Build and verify**

Run: `pnpm build`
Expected: Build succeeds. Browser tab shows brain+sparkles favicon.

- [ ] **Step 3: Commit**

```
git add src/ui/index.html
git commit -m "feat: add brain+sparkles SVG favicon"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run test/`
Expected: ALL pass.

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: Succeeds with no errors.

- [ ] **Step 3: Visual verification on running dashboard**

Open http://localhost:24636 and verify:
- Domain headers show counts like `frontend (12)`
- Filter icon appears on hover for domain/category headers
- Clicking filter icon shows filter bar with clear button
- Search bar at top of memories panel works
- Brain+sparkles logo in header
- Brain+sparkles favicon in browser tab
