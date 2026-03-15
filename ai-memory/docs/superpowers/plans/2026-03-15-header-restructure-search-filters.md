# Header Restructure + Search Filters Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the dashboard header into two rows with a project typeahead and a unified search + filter bar with Datadog-style tag picking.

**Architecture:** Split the single-row header into a top bar (branding + actions) and a context strip (project typeahead + search bar). Replace the `<select>`-based `ProjectSelector` with a typeahead combobox. Create a new `SearchBar` component that combines free-text search with a multi-select filter picker for domains, categories, and tags.

**Tech Stack:** SolidJS, Tailwind CSS, Hono (backend), SQLite via better-sqlite3, Font Awesome icons

**Spec:** `docs/superpowers/specs/2026-03-15-header-restructure-search-filters-design.md`

---

## Chunk 1: Backend Changes

### Task 1: Add GET /api/tags endpoint

**Files:**
- Modify: `src/app.ts:375-378` (add route before taxonomy-summary)
- Test: `test/search.test.ts` (add new describe block)

- [ ] **Step 1: Write the failing test**

Add to the end of `test/search.test.ts`:

```typescript
describe('GET /api/tags', () => {
    it('returns tags with counts', async () => {
        const proj = getOrCreateProject('/test/tags');
        insertMemory(proj.id, 'auth flow', 'auth,security', 'fact', 3, '', 'backend');
        insertMemory(proj.id, 'auth tokens', 'auth,jwt', 'fact', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/tags?project=/test/tags');
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json).toBeInstanceOf(Array);
        // "auth" appears in both memories → count=2
        const authTag = json.find((t: any) => t.tag === 'auth');
        expect(authTag).toBeDefined();
        expect(authTag.count).toBe(2);
    });

    it('returns all tags when no project specified', async () => {
        const proj = getOrCreateProject('/test/tags2');
        insertMemory(proj.id, 'test mem', 'unique-tag', 'fact', 3, '', 'general');

        const app = makeApp();
        const res = await app.request('/api/tags');
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.some((t: any) => t.tag === 'unique-tag')).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/search.test.ts`
Expected: FAIL — 404 on `/api/tags`

- [ ] **Step 3: Implement the endpoint**

In `src/app.ts`, add after line 375 (after the `/api/search` handler's closing `});`):

```typescript
    // ── HTTP API: Tags ──────────────────────────────────────────────
    app.get('/api/tags', (c) => {
        const project = c.req.query('project');
        return c.json(listTags(project));
    });
```

`listTags` is already imported in `app.ts` (line 35).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.ts test/search.test.ts
git commit -m "feat: add GET /api/tags endpoint"
```

---

### Task 2: Support filter-only queries and comma-separated filter params in /api/search

**Files:**
- Modify: `src/app.ts:329-375` (search handler)
- Modify: `src/db.ts:386-427` (searchMemories)
- Modify: `src/db.ts:429-471` (searchMemoriesFuzzy)
- Modify: `src/db.ts:473-509` (listMemories)
- Test: `test/search.test.ts`

- [ ] **Step 1: Write failing tests for multi-value filters and filter-only queries**

Add to the `describe('GET /api/search', ...)` block in `test/search.test.ts`:

```typescript
    it('supports comma-separated domain filter (OR)', async () => {
        const proj = getOrCreateProject('/test/search-multi');
        insertMemory(proj.id, 'frontend auth flow', 'auth', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'backend auth flow', 'auth', 'fact', 3, '', 'backend');
        insertMemory(proj.id, 'data auth flow', 'auth', 'fact', 3, '', 'data');

        const app = makeApp();
        const res = await app.request('/api/search?q=auth&project=/test/search-multi&domain=frontend,backend');
        const json = await res.json() as any;
        expect(json.results).toHaveLength(2);
        const domains = json.results.map((r: any) => r.domain).sort();
        expect(domains).toEqual(['backend', 'frontend']);
    });

    it('supports comma-separated tag filter (OR)', async () => {
        const proj = getOrCreateProject('/test/search-multi-tag');
        insertMemory(proj.id, 'jwt auth', 'jwt', 'fact', 3, '', 'backend');
        insertMemory(proj.id, 'session auth', 'session', 'fact', 3, '', 'backend');
        insertMemory(proj.id, 'basic auth', 'basic', 'fact', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/search?q=auth&project=/test/search-multi-tag&tag=jwt,session');
        const json = await res.json() as any;
        expect(json.results).toHaveLength(2);
    });

    it('returns filter-only results when q is empty but filters are present', async () => {
        const proj = getOrCreateProject('/test/search-filter-only');
        insertMemory(proj.id, 'frontend component', 'react', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'backend service', 'node', 'fact', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/search?project=/test/search-filter-only&domain=frontend');
        const json = await res.json() as any;
        expect(json.results).toHaveLength(1);
        expect(json.results[0].domain).toBe('frontend');
    });

    it('supports comma-separated category filter (OR)', async () => {
        const proj = getOrCreateProject('/test/search-multi-cat');
        insertMemory(proj.id, 'solution memory', 'tag1', 'solution', 3, '', 'backend');
        insertMemory(proj.id, 'pattern memory', 'tag2', 'pattern', 3, '', 'backend');
        insertMemory(proj.id, 'fact memory', 'tag3', 'fact', 3, '', 'backend');

        const app = makeApp();
        const res = await app.request('/api/search?q=memory&project=/test/search-multi-cat&category=solution,pattern');
        const json = await res.json() as any;
        expect(json.results).toHaveLength(2);
        const cats = json.results.map((r: any) => r.category).sort();
        expect(cats).toEqual(['pattern', 'solution']);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/search.test.ts`
Expected: FAIL — multi-value filters not supported, filter-only returns empty

- [ ] **Step 3: Update db.ts query functions to accept arrays**

Modify all three functions in `src/db.ts`. For each, update the **function signature** to change `tag`, `category`, and `domain` parameter types from `string | undefined` to `string | string[] | undefined`, then update the SQL building logic.

**`searchMemories`** (lines 386-427) — change signature to:
```typescript
export function searchMemories(
    query: string,
    projectPath?: string,
    tag?: string | string[],
    category?: string | string[],
    limit = 20,
    domain?: string | string[],
): any[] {
```

Then update the SQL building logic for each filter:

For **tag** (around line 408-411):
```typescript
    if (tag) {
        if (Array.isArray(tag)) {
            const clauses = tag.map(() => 'm.tags LIKE ?');
            sql += ` AND (${clauses.join(' OR ')})`;
            params.push(...tag.map(t => `%${t}%`));
        } else {
            sql += ' AND m.tags LIKE ?';
            params.push(`%${tag}%`);
        }
    }
```

For **category** (around line 412-415):
```typescript
    if (category) {
        if (Array.isArray(category)) {
            sql += ` AND m.category IN (${category.map(() => '?').join(',')})`;
            params.push(...category);
        } else {
            sql += ' AND m.category = ?';
            params.push(category);
        }
    }
```

For **domain** (around line 416-419):
```typescript
    if (domain) {
        if (Array.isArray(domain)) {
            sql += ` AND m.domain IN (${domain.map(() => '?').join(',')})`;
            params.push(...domain);
        } else {
            sql += ' AND m.domain = ?';
            params.push(domain);
        }
    }
```

**`searchMemoriesFuzzy`** (lines 429-471) — change signature to:
```typescript
export function searchMemoriesFuzzy(
    query: string,
    projectPath?: string,
    tag?: string | string[],
    category?: string | string[],
    limit = 20,
    domain?: string | string[],
): any[] {
```
Apply the exact same array handling for tag/category/domain as `searchMemories` above.

**`listMemories`** (lines 473-509) — change signature to:
```typescript
export function listMemories(projectPath?: string, tag?: string | string[], category?: string | string[], limit = 50, domain?: string | string[]): any[]
```
For `listMemories`, the pattern is slightly different because it builds a `conditions[]` array. Change:
```typescript
    if (tag) {
        if (Array.isArray(tag)) {
            const clauses = tag.map(() => 'm.tags LIKE ?');
            conditions.push(`(${clauses.join(' OR ')})`);
            params.push(...tag.map(t => `%${t}%`));
        } else {
            conditions.push('m.tags LIKE ?');
            params.push(`%${tag}%`);
        }
    }
    if (category) {
        if (Array.isArray(category)) {
            conditions.push(`m.category IN (${category.map(() => '?').join(',')})`);
            params.push(...category);
        } else {
            conditions.push('m.category = ?');
            params.push(category);
        }
    }
    if (domain) {
        if (Array.isArray(domain)) {
            conditions.push(`m.domain IN (${domain.map(() => '?').join(',')})`);
            params.push(...domain);
        } else {
            conditions.push('m.domain = ?');
            params.push(domain);
        }
    }
```

- [ ] **Step 4: Update /api/search handler to split commas and support filter-only**

In `src/app.ts`, replace the search handler (lines 329-375) with:

```typescript
    app.get('/api/search', (c) => {
        try {
            const q = c.req.query('q') || '';
            const project = c.req.query('project');
            const rawDomain = c.req.query('domain');
            const rawCategory = c.req.query('category');
            const rawTag = c.req.query('tag');
            const rawLimit = Number(c.req.query('limit') || '20');
            const limit = rawLimit < 0 ? 20 : rawLimit;

            // Split comma-separated filter values
            const domain = rawDomain ? rawDomain.split(',').filter(Boolean) : undefined;
            const category = rawCategory ? rawCategory.split(',').filter(Boolean) : undefined;
            const tag = rawTag ? rawTag.split(',').filter(Boolean) : undefined;

            // Unwrap single-element arrays to strings for backward compatibility
            const domainParam = domain?.length === 1 ? domain[0] : domain;
            const categoryParam = category?.length === 1 ? category[0] : category;
            const tagParam = tag?.length === 1 ? tag[0] : tag;

            // Filter-only query (no text search)
            if (!q.trim()) {
                if (!domainParam && !categoryParam && !tagParam) {
                    return c.json({ results: [] });
                }
                const results = listMemories(project, tagParam, categoryParam, limit, domainParam);
                return c.json({ results });
            }

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
            const wordResults = searchMemories(wordQuery, project, tagParam, categoryParam, limit, domainParam);

            // 2. Trigram fallback for remaining slots (substring matching)
            const seen = new Set<number>(wordResults.map((r: any) => r.id));
            let combined = [...wordResults];

            if (limit === 0 || combined.length < limit) {
                const trigramQuery = unique.join(' OR ');
                const remaining = limit === 0 ? 0 : limit - combined.length;
                const trigramResults = searchMemoriesFuzzy(trigramQuery, project, tagParam, categoryParam, remaining, domainParam);
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/search.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/db.ts test/search.test.ts
git commit -m "feat: support filter-only queries and comma-separated filter params in search"
```

---

## Chunk 2: Frontend — Header Restructure + ProjectSelector Typeahead

### Task 3: Restructure App.tsx header into two rows

**Files:**
- Modify: `src/ui/App.tsx:226-229` (resource types), `src/ui/App.tsx:366-451` (header JSX)

This task restructures the header layout. The `ProjectSelector` and `SearchBar` components are wired in subsequent tasks — use placeholder `<div>` elements for now.

- [ ] **Step 1: Update domain/category resource types to include `count`**

In `src/ui/App.tsx`, change lines 228-229 from:
```typescript
    const [domainMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string }[]>('/api/domains'));
    const [categoryMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string }[]>('/api/categories'));
```
to:
```typescript
    const [domainMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string; count: number }[]>('/api/domains'));
    const [categoryMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string; count: number }[]>('/api/categories'));
```

- [ ] **Step 2: Add tags resource**

After the `categoryMeta` resource (line 229), add:
```typescript
    const [tagsMeta] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}` : '';
            return api<{ tag: string; count: number }[]>('/api/tags' + qs);
        },
    );
```

- [ ] **Step 3: Restructure header JSX into two rows**

Replace the entire `<header>` block (lines 369-451) with:

```tsx
            <header class="shrink-0">
                {/* Row 1: Brand + actions */}
                <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                    <div class="flex items-center gap-3">
                        <h1 class="text-xl font-bold text-neutral-200 flex items-center gap-2">
                            <BrandLogo size={20} />
                            ai-memory
                        </h1>
                        <a
                            href="https://github.com/damusix/ai-tools"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-neutral-500 hover:text-[#d77757] transition-colors flex items-center"
                            title="GitHub"
                        >
                            <i class="fa-brands fa-github" style="font-size: 16px"></i>
                        </a>
                    </div>
                    <div class="flex items-center gap-2">
                        <button
                            onClick={() => setSettingsOpen(true)}
                            class="px-2 py-1.5 rounded text-neutral-500 hover:text-[#d77757] transition-colors flex items-center"
                            title="Settings"
                        >
                            <Icon name="gear" size={15} />
                        </button>
                        <button
                            onClick={() => openHelp('about')}
                            class="px-2 py-1.5 rounded text-neutral-500 hover:text-[#d77757] transition-colors flex items-center"
                            title="Help"
                        >
                            <Icon name="info" size={15} />
                        </button>
                        <button
                            onClick={() => setLogsOpen(true)}
                            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                            title="View server logs"
                        >
                            <Icon name="terminal" size={14} />
                            Logs
                        </button>
                        <button
                            onClick={() => setTransferOpen(true)}
                            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                            title="Transfer memories between projects"
                        >
                            <Icon name="transfer" size={14} />
                            Transfer
                        </button>
                        <button
                            onClick={handleCleanup}
                            disabled={cleaningUp()}
                            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                            title="Remove junk observations and duplicate memories"
                        >
                            <Icon name="broom" size={14} />
                            {cleaningUp() ? 'Cleaning...' : 'Clean up'}
                        </button>
                        <button
                            onClick={handleRestart}
                            disabled={restarting()}
                            class="px-2 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 disabled:opacity-50 transition-colors flex items-center"
                            title="Restart the ai-memory server"
                        >
                            <Icon name="rotate-cw" size={14} class={restarting() ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => setStopConfirm(true)}
                            class="px-2 py-1.5 text-xs rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 transition-colors flex items-center"
                            title="Stop the ai-memory server"
                        >
                            <i class="fa-solid fa-stop" style="font-size: 14px"></i>
                        </button>
                    </div>
                </div>

                {/* Row 2: Project + Search context strip */}
                <div class="flex items-start gap-4 px-4 py-2 bg-neutral-950 border-b border-neutral-800/50">
                    {/* Left: Project selector */}
                    <div class="w-[240px] shrink-0">
                        <ProjectSelector
                            projects={projects() || []}
                            selected={project()}
                            onChange={selectProject}
                            onDeleteProject={() => {
                                const proj = (projects() || []).find((p: any) => p.path === project());
                                if (proj) setDeleteProjectTarget(proj);
                            }}
                        />
                    </div>
                    {/* Right: Search bar (placeholder for now) */}
                    <div class="flex-1">
                        <input
                            type="text"
                            placeholder="Search memories..."
                            class="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                            value={searchQuery()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSearch(e.currentTarget.value);
                            }}
                        />
                    </div>
                </div>
            </header>
```

- [ ] **Step 4: Remove the old inline search bar from the main panel**

Delete the search bar `<div class="mb-3 relative">` block (around lines 520-539 in the original, now within the `<main>` section). The search input is now in the header's row 2.

- [ ] **Step 5: Verify the UI build compiles**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build:ui`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: restructure header into two rows with GitHub link"
```

---

### Task 4: Rewrite ProjectSelector as typeahead combobox

**Files:**
- Modify: `src/ui/components/ProjectSelector.tsx` (full rewrite)

- [ ] **Step 1: Rewrite ProjectSelector**

Replace the entire content of `src/ui/components/ProjectSelector.tsx` with:

```tsx
import { createSignal, createMemo, createEffect, For, Show, onCleanup, type Component } from 'solid-js';
import type { Project } from '../App';
import { shortPath } from '../App';
import Icon from './Icon';

export const ProjectSelector: Component<{
    projects: Project[];
    selected: string;
    onChange: (path: string) => void;
    onDeleteProject?: () => void;
    stats?: { memories: number; observations: number };
}> = (props) => {
    const [query, setQuery] = createSignal('');
    const [open, setOpen] = createSignal(false);
    const [highlightIndex, setHighlightIndex] = createSignal(0);
    let inputRef!: HTMLInputElement;
    let containerRef!: HTMLDivElement;

    const selectedProject = createMemo(() =>
        props.projects.find(p => p.path === props.selected)
    );

    const displayName = createMemo(() => {
        if (!props.selected) return 'All projects';
        const proj = selectedProject();
        return proj ? proj.name : shortPath(props.selected);
    });

    const filtered = createMemo(() => {
        const q = query().toLowerCase();
        if (!q) return props.projects;
        return props.projects.filter(p =>
            p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
        );
    });

    // Reset highlight when filtered list changes
    createEffect(() => {
        filtered();
        setHighlightIndex(0);
    });

    const select = (path: string) => {
        props.onChange(path);
        setQuery('');
        setOpen(false);
        inputRef?.blur();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (!open()) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setOpen(true);
                e.preventDefault();
            }
            return;
        }

        const items = filtered();
        // +1 for "All projects" option at index 0
        const total = items.length + 1;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightIndex(i => (i + 1) % total);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightIndex(i => (i - 1 + total) % total);
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightIndex() === 0) {
                    select('');
                } else {
                    const proj = items[highlightIndex() - 1];
                    if (proj) select(proj.path);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setQuery('');
                setOpen(false);
                inputRef?.blur();
                break;
        }
    };

    // Close on click outside
    const handleClickOutside = (e: MouseEvent) => {
        if (containerRef && !containerRef.contains(e.target as Node)) {
            setQuery('');
            setOpen(false);
        }
    };

    createEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
    });

    return (
        <div ref={containerRef} class="relative">
            <div class="relative">
                <i class="fa-solid fa-folder-open absolute left-2.5 top-1/2 -translate-y-1/2 text-[#d77757]" style="font-size: 11px"></i>
                <input
                    ref={inputRef}
                    type="text"
                    class="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 pl-7 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
                    placeholder={displayName()}
                    value={open() ? query() : ''}
                    onFocus={() => {
                        setOpen(true);
                        setQuery('');
                    }}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {/* Stats line */}
            <div class="flex gap-2.5 mt-1 px-1">
                <span class="text-[9px] text-[#d77757]/50 flex items-center gap-1">
                    <Icon name="brain" size={9} />
                    {props.stats?.memories ?? 0} memories
                </span>
                <span class="text-[9px] text-purple-300/50 flex items-center gap-1">
                    <Icon name="eye" size={9} />
                    {props.stats?.observations ?? 0} observations
                </span>
            </div>

            {/* Dropdown */}
            <Show when={open()}>
                <div class="absolute z-50 top-[calc(100%-14px)] left-0 w-full bg-neutral-900 border border-neutral-700 rounded shadow-lg max-h-64 overflow-y-auto">
                    {/* All projects option */}
                    <button
                        class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                            highlightIndex() === 0 ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                        }`}
                        onMouseEnter={() => setHighlightIndex(0)}
                        onClick={() => select('')}
                    >
                        <i class="fa-solid fa-layer-group" style="font-size: 11px"></i>
                        <span>All projects</span>
                    </button>

                    <For each={filtered()}>
                        {(proj, idx) => (
                            <div
                                class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors group/item ${
                                    highlightIndex() === idx() + 1 ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                                }`}
                                onMouseEnter={() => setHighlightIndex(idx() + 1)}
                            >
                                <button
                                    class="flex items-center gap-2 flex-1 min-w-0"
                                    onClick={() => select(proj.path)}
                                >
                                    <i class={`fa-solid ${proj.path === '_global' ? 'fa-globe' : (proj.icon || 'fa-folder-open')} text-[#d77757] shrink-0`} style="font-size: 11px"></i>
                                    <span class="truncate">{proj.name}</span>
                                    <span class="text-[10px] text-neutral-600 shrink-0">
                                        {proj.memory_count}m / {proj.observation_count}o
                                    </span>
                                </button>
                                <Show when={proj.path !== '_global'}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            props.onChange(proj.path);
                                            props.onDeleteProject?.();
                                            setOpen(false);
                                        }}
                                        class="p-0.5 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0"
                                        title="Delete project"
                                    >
                                        <i class="fa-solid fa-trash" style="font-size: 9px"></i>
                                    </button>
                                </Show>
                            </div>
                        )}
                    </For>

                    <Show when={filtered().length === 0 && query()}>
                        <div class="px-3 py-2 text-xs text-neutral-500">No matching projects</div>
                    </Show>
                </div>
            </Show>
        </div>
    );
};
```

- [ ] **Step 2: Wire stats prop in App.tsx**

In `src/ui/App.tsx`, find the `<ProjectSelector>` usage in the header's row 2 and add the `stats` prop:

```tsx
                        <ProjectSelector
                            projects={projects() || []}
                            selected={project()}
                            onChange={selectProject}
                            onDeleteProject={() => {
                                const proj = (projects() || []).find((p: any) => p.path === project());
                                if (proj) setDeleteProjectTarget(proj);
                            }}
                            stats={stats()}
                        />
```

- [ ] **Step 3: Verify the UI build compiles**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build:ui`
Expected: PASS — no TypeScript errors

- [ ] **Step 4: Verify full test suite still passes**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ProjectSelector.tsx src/ui/App.tsx
git commit -m "feat: rewrite ProjectSelector as typeahead combobox with stats"
```

---

## Chunk 3: Frontend — SearchBar Component

### Task 5: Create SearchBar component

**Files:**
- Create: `src/ui/components/SearchBar.tsx`
- Modify: `src/ui/App.tsx` (wire SearchBar, remove old search state)

- [ ] **Step 1: Create SearchBar.tsx**

Create `src/ui/components/SearchBar.tsx`:

```tsx
import { createSignal, createMemo, createEffect, For, Show, onCleanup, type Component } from 'solid-js';
import type { Memory } from '../App';
import Icon from './Icon';

type FilterType = 'domain' | 'category' | 'tag';
type Filter = { type: FilterType; value: string; icon: string };

type DomainMeta = { name: string; icon: string; count: number };
type CategoryMeta = { name: string; icon: string; count: number };
type TagMeta = { tag: string; count: number };

const FILTER_COLORS: Record<FilterType, { bg: string; text: string }> = {
    domain: { bg: 'bg-[#d77757]/15', text: 'text-[#d77757]' },
    category: { bg: 'bg-purple-400/15', text: 'text-purple-400' },
    tag: { bg: 'bg-teal-400/15', text: 'text-teal-400' },
};

const FILTER_LABELS: Record<FilterType, string> = {
    domain: 'Domains',
    category: 'Categories',
    tag: 'Tags',
};

export const SearchBar: Component<{
    project: string;
    domains: DomainMeta[];
    categories: CategoryMeta[];
    tags: TagMeta[];
    onResults: (memories: Memory[] | null) => void;
    onSearchTextChange?: (text: string) => void;
}> = (props) => {
    const [query, setQuery] = createSignal('');
    const [open, setOpen] = createSignal(false);
    const [filters, setFilters] = createSignal<Filter[]>([]);
    const [searchText, setSearchText] = createSignal('');
    const [highlightIndex, setHighlightIndex] = createSignal(0);
    let inputRef!: HTMLInputElement;
    let containerRef!: HTMLDivElement;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    // Build the available options, excluding already-selected filters
    const selectedKeys = createMemo(() => {
        const keys: Record<string, true> = {};
        for (const f of filters()) keys[`${f.type}:${f.value}`] = true;
        return keys;
    });

    const filteredOptions = createMemo(() => {
        const q = query().toLowerCase();
        const selected = selectedKeys();
        const groups: { type: FilterType; items: { value: string; icon: string; count: number }[] }[] = [];

        // Domains
        const domainItems = (props.domains || [])
            .filter(d => !selected[`domain:${d.name}`] && d.count > 0)
            .filter(d => !q || d.name.toLowerCase().includes(q))
            .map(d => ({ value: d.name, icon: d.icon, count: d.count }));
        if (domainItems.length > 0) groups.push({ type: 'domain', items: domainItems });

        // Categories
        const categoryItems = (props.categories || [])
            .filter(c => !selected[`category:${c.name}`] && c.count > 0)
            .filter(c => !q || c.name.toLowerCase().includes(q))
            .map(c => ({ value: c.name, icon: c.icon, count: c.count }));
        if (categoryItems.length > 0) groups.push({ type: 'category', items: categoryItems });

        // Tags
        const tagItems = (props.tags || [])
            .filter(t => !selected[`tag:${t.tag}`])
            .filter(t => !q || t.tag.toLowerCase().includes(q))
            .map(t => ({ value: t.tag, icon: 'fa-tag', count: t.count }));
        if (tagItems.length > 0) groups.push({ type: 'tag', items: tagItems });

        return groups;
    });

    // Flat list for keyboard navigation
    const flatOptions = createMemo(() => {
        const flat: { type: FilterType; value: string; icon: string; count: number }[] = [];
        for (const group of filteredOptions()) {
            for (const item of group.items) {
                flat.push({ type: group.type, ...item });
            }
        }
        return flat;
    });

    createEffect(() => {
        flatOptions();
        setHighlightIndex(0);
    });

    const addFilter = (type: FilterType, value: string, icon: string) => {
        setFilters(prev => [...prev, { type, value, icon }]);
        setQuery('');
        inputRef?.focus();
    };

    const removeFilter = (type: FilterType, value: string) => {
        setFilters(prev => prev.filter(f => !(f.type === type && f.value === value)));
    };

    const clearSearchText = () => {
        setSearchText('');
        props.onSearchTextChange?.('');
    };

    // Execute search/filter query
    const executeQuery = () => {
        const activeFilters = filters();
        const text = searchText();

        if (!text && activeFilters.length === 0) {
            props.onResults(null);
            return;
        }

        const params = new URLSearchParams();
        if (text) params.set('q', text);
        if (props.project) params.set('project', props.project);

        const domains = activeFilters.filter(f => f.type === 'domain').map(f => f.value);
        const categories = activeFilters.filter(f => f.type === 'category').map(f => f.value);
        const tags = activeFilters.filter(f => f.type === 'tag').map(f => f.value);

        if (domains.length > 0) params.set('domain', domains.join(','));
        if (categories.length > 0) params.set('category', categories.join(','));
        if (tags.length > 0) params.set('tag', tags.join(','));

        fetch(`/api/search?${params}`)
            .then(r => r.json())
            .then((data: any) => props.onResults(data.results))
            .catch(() => props.onResults([]));
    };

    // Debounced execute when filters change
    createEffect(() => {
        filters(); // track
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(executeQuery, 200);
    });

    // Re-execute when project changes
    createEffect(() => {
        props.project; // track
        const activeFilters = filters();
        const text = searchText();
        if (text || activeFilters.length > 0) {
            executeQuery();
        }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
        const flat = flatOptions();

        if (!open()) {
            if (e.key === 'ArrowDown') {
                setOpen(true);
                e.preventDefault();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = query().trim();
                if (val) {
                    setSearchText(val);
                    props.onSearchTextChange?.(val);
                    setQuery('');
                    setOpen(false);
                    executeQuery();
                }
            }
            return;
        }

        // Check if "Search for" row is highlighted (last item)
        const hasSearchRow = query().trim().length > 0;
        const total = flat.length + (hasSearchRow ? 1 : 0);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightIndex(i => (i + 1) % total);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightIndex(i => (i - 1 + total) % total);
                break;
            case 'Enter':
                e.preventDefault();
                if (hasSearchRow && highlightIndex() === flat.length) {
                    // "Search for" row
                    setSearchText(query().trim());
                    props.onSearchTextChange?.(query().trim());
                    setQuery('');
                    setOpen(false);
                    executeQuery();
                } else if (flat[highlightIndex()]) {
                    const item = flat[highlightIndex()];
                    addFilter(item.type, item.value, item.icon);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setOpen(false);
                break;
        }
    };

    // Close on click outside
    const handleClickOutside = (e: MouseEvent) => {
        if (containerRef && !containerRef.contains(e.target as Node)) {
            setOpen(false);
        }
    };

    createEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
    });

    // Reset filters when project changes
    createEffect(() => {
        props.project;
        setFilters([]);
        setSearchText('');
        props.onSearchTextChange?.('');
        setQuery('');
        props.onResults(null);
    });

    return (
        <div ref={containerRef} class="relative">
            <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" style="font-size: 11px"></i>
                <input
                    ref={inputRef}
                    type="text"
                    class="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 pl-7 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
                    placeholder="Search or filter..."
                    value={query()}
                    onFocus={() => setOpen(true)}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {/* Pills row */}
            <Show when={filters().length > 0 || searchText()}>
                <div class="flex gap-1 mt-1 px-0.5 flex-wrap">
                    {/* Search text pill */}
                    <Show when={searchText()}>
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-neutral-700/50 text-neutral-300">
                            <i class="fa-solid fa-magnifying-glass" style="font-size: 8px"></i>
                            "{searchText()}"
                            <button
                                class="ml-0.5 text-neutral-500 hover:text-neutral-300"
                                onClick={() => { clearSearchText(); executeQuery(); }}
                            >
                                <i class="fa-solid fa-xmark" style="font-size: 8px"></i>
                            </button>
                        </span>
                    </Show>
                    {/* Filter pills */}
                    <For each={filters()}>
                        {(f) => {
                            const colors = FILTER_COLORS[f.type];
                            return (
                                <span class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${colors.bg} ${colors.text}`}>
                                    <i class={`fa-solid ${f.icon}`} style="font-size: 8px"></i>
                                    {f.value}
                                    <button
                                        class="ml-0.5 opacity-60 hover:opacity-100"
                                        onClick={() => removeFilter(f.type, f.value)}
                                    >
                                        <i class="fa-solid fa-xmark" style="font-size: 8px"></i>
                                    </button>
                                </span>
                            );
                        }}
                    </For>
                </div>
            </Show>

            {/* Dropdown */}
            <Show when={open()}>
                <div class="absolute z-50 top-[34px] left-0 w-full bg-neutral-900 border border-neutral-700 rounded shadow-lg max-h-72 overflow-y-auto">
                    {(() => {
                        let flatIdx = 0;
                        return (
                            <>
                                <For each={filteredOptions()}>
                                    {(group) => (
                                        <div>
                                            <div class={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${FILTER_COLORS[group.type].text} opacity-60`}>
                                                {FILTER_LABELS[group.type]}
                                            </div>
                                            <For each={group.items}>
                                                {(item) => {
                                                    const myIdx = flatIdx++;
                                                    return (
                                                        <button
                                                            class={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 transition-colors ${
                                                                highlightIndex() === myIdx ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                                                            }`}
                                                            onMouseEnter={() => setHighlightIndex(myIdx)}
                                                            onClick={() => addFilter(group.type, item.value, item.icon)}
                                                        >
                                                            <i class={`fa-solid ${item.icon} ${FILTER_COLORS[group.type].text}`} style="font-size: 11px"></i>
                                                            <span class="flex-1">{item.value}</span>
                                                            <span class="text-[10px] text-neutral-600">{item.count}</span>
                                                        </button>
                                                    );
                                                }}
                                            </For>
                                        </div>
                                    )}
                                </For>

                                {/* "Search for" row */}
                                <Show when={query().trim()}>
                                    {(() => {
                                        const searchIdx = flatOptions().length;
                                        return (
                                            <button
                                                class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-t border-neutral-800 transition-colors ${
                                                    highlightIndex() === searchIdx ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                                                }`}
                                                onMouseEnter={() => setHighlightIndex(searchIdx)}
                                                onClick={() => {
                                                    setSearchText(query().trim());
                                                    props.onSearchTextChange?.(query().trim());
                                                    setQuery('');
                                                    setOpen(false);
                                                    executeQuery();
                                                }}
                                            >
                                                <i class="fa-solid fa-magnifying-glass" style="font-size: 11px"></i>
                                                <span>Search for "<strong>{query().trim()}</strong>"</span>
                                            </button>
                                        );
                                    })()}
                                </Show>

                                <Show when={filteredOptions().length === 0 && !query().trim()}>
                                    <div class="px-3 py-2 text-xs text-neutral-500">No filters available</div>
                                </Show>
                            </>
                        );
                    })()}
                </div>
            </Show>
        </div>
    );
};
```

- [ ] **Step 2: Wire SearchBar into App.tsx**

In `src/ui/App.tsx`:

1. Add import at the top:
```typescript
import { SearchBar } from './components/SearchBar';
```

2. Replace the search placeholder `<div>` in the header's row 2 (the `<div class="flex-1">` with the temporary input) with:
```tsx
                    <div class="flex-1">
                        <SearchBar
                            project={project()}
                            domains={domainMeta() || []}
                            categories={categoryMeta() || []}
                            tags={tagsMeta() || []}
                            onResults={setSearchResults}
                            onSearchTextChange={setSearchQuery}
                        />
                    </div>
```

3. Remove the old `handleSearch` function (lines 111-129) and `clearSearch` function (lines 131-134) since `SearchBar` handles this internally.

4. Remove the `createEffect` that calls `clearSearch` on project change (lines 136-139) — `SearchBar` handles its own reset.

5. Keep `searchQuery` and `setSearchQuery` signals — `SearchBar` calls `onSearchTextChange` to keep them in sync, and the search results rendering in the main panel still references `searchQuery()` to display "N results for 'query'". Keep `searchResults` and `setSearchResults` — they're still used to render results.

- [ ] **Step 3: Verify UI builds**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build:ui`
Expected: PASS

- [ ] **Step 4: Verify full test suite**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/SearchBar.tsx src/ui/App.tsx
git commit -m "feat: add SearchBar component with unified search and filter picker"
```

---

### Task 6: Final cleanup and full build verification

**Files:**
- Modify: `src/ui/App.tsx` (any remaining cleanup)

- [ ] **Step 1: Remove any dead code**

In `src/ui/App.tsx`, check for:
- Unused `searchQuery` signal — remove if no longer referenced
- Unused `handleSearch` / `clearSearch` functions — remove if not already removed
- The old search results rendering (`Show when={searchResults() !== null}`) should still work since `SearchBar` calls `setSearchResults` via `onResults`

- [ ] **Step 2: Full build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: PASS (both server + UI)

- [ ] **Step 3: Full test suite**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS

- [ ] **Step 4: Commit any cleanup**

```bash
git add -u
git commit -m "chore: remove dead search code from App.tsx"
```
