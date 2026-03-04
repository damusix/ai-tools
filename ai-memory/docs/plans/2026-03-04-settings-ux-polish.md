# Settings UX Polish & Overflow Fixes — Implementation Plan


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish Settings modal UX (help text, unified delete, restore defaults) and fix overflow bugs in observation sidebar/cards.

**Architecture:** Pure UI polish + two new backend functions for restore-defaults. No schema changes.

**Tech Stack:** SolidJS, Tailwind CSS, Hono, better-sqlite3

---


### Task 1: Backend — Export seeds and add restore functions

**Files:**
- Modify: `src/db.ts:144-182` (extract seeds to module-level exports, add restore functions)

**Step 1: Move seed arrays to module-level exports**

Move `domainSeed` and `categorySeed` from inside `initSchema()` to module-level exported constants. Inside `initSchema()`, reference the exports.

In `src/db.ts`, before the `export function initSchema()` function, add:

```typescript
export const DOMAIN_SEED: [string, string, string][] = [
    ['frontend', 'UI components, routing, state management, browser APIs, DOM', 'fa-display'],
    ['styling', 'CSS, themes, layouts, responsive design, animations', 'fa-palette'],
    ['backend', 'Server logic, business rules, middleware, request handling', 'fa-server'],
    ['api', 'API design, REST/GraphQL contracts, versioning, endpoints', 'fa-globe'],
    ['data', 'Database, schemas, queries, migrations, ORMs, caching', 'fa-database'],
    ['auth', 'Authentication, authorization, sessions, tokens, RBAC', 'fa-key'],
    ['testing', 'Test frameworks, strategies, fixtures, mocking, coverage', 'fa-vial'],
    ['performance', 'Optimization, caching, profiling, lazy loading, bundle size', 'fa-gauge-high'],
    ['security', 'Vulnerabilities, hardening, input validation, OWASP', 'fa-shield-halved'],
    ['accessibility', 'a11y, WCAG, screen readers, keyboard navigation', 'fa-universal-access'],
    ['infrastructure', 'Deployment, hosting, cloud, Docker, serverless', 'fa-cloud'],
    ['devops', 'CI/CD, pipelines, environments, release process', 'fa-code-branch'],
    ['monitoring', 'Logging, alerting, observability, error tracking', 'fa-chart-line'],
    ['tooling', 'Build tools, linters, formatters, bundlers, dev environment', 'fa-wrench'],
    ['git', 'Version control, branching strategy, hooks, workflows', 'fa-code-branch'],
    ['dependencies', 'Package management, upgrades, compatibility, vendoring', 'fa-cubes'],
    ['architecture', 'System design, patterns, module structure, conventions', 'fa-sitemap'],
    ['integrations', 'Third-party services, SDKs, webhooks, external APIs', 'fa-plug'],
    ['general', 'Cross-cutting concerns that don\'t fit elsewhere', 'fa-folder'],
];

export const CATEGORY_SEED: [string, string, string][] = [
    ['decision', 'A choice made between options, with rationale', 'fa-gavel'],
    ['pattern', 'A recurring approach established for the codebase', 'fa-repeat'],
    ['preference', 'A user style or workflow preference', 'fa-sliders'],
    ['fact', 'A discovered truth about the system or environment', 'fa-bookmark'],
    ['solution', 'A working fix for a non-obvious problem', 'fa-puzzle-piece'],
];
```

Then in `initSchema()`, replace the inline `domainSeed`/`categorySeed` with `DOMAIN_SEED`/`CATEGORY_SEED`.

**Step 2: Add restore functions**

After the existing `forceDeleteCategory` function (~line 543), add:

```typescript
export function restoreDefaultDomains(): number {
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO domains (name, description, icon) VALUES (?, ?, ?)');
    let restored = 0;
    for (const [name, desc, icon] of DOMAIN_SEED) {
        const result = stmt.run(name, desc, icon);
        if (result.changes > 0) restored++;
    }
    return restored;
}

export function restoreDefaultCategories(): number {
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)');
    let restored = 0;
    for (const [name, desc, icon] of CATEGORY_SEED) {
        const result = stmt.run(name, desc, icon);
        if (result.changes > 0) restored++;
    }
    return restored;
}
```

**Step 3: Run tests**

Run: `cd ai-memory && pnpm vitest run test/`
Expected: All existing tests pass (no regressions from refactor).

**Step 4: Commit**

```
feat: export taxonomy seeds and add restore-defaults functions
```

---


### Task 2: Backend — Add restore-defaults API endpoints

**Files:**
- Modify: `src/app.ts:7-31` (add imports)
- Modify: `src/app.ts:185-231` (add endpoints between force-delete and categories GET)

**Step 1: Add imports**

In `src/app.ts` line 7-31, add `restoreDefaultDomains` and `restoreDefaultCategories` to the import block from `./db.js`.

**Step 2: Add endpoints**

After `app.delete('/api/domains/:name/force', ...)` (line 185) and before `app.get('/api/categories', ...)` (line 187), add:

```typescript
    app.post('/api/domains/restore-defaults', (c) => {
        const restored = restoreDefaultDomains();
        log('api', `Restored default domains (${restored} added)`);
        broadcast('counts:updated', {});
        return c.json({ restored });
    });
```

After `app.delete('/api/categories/:name/force', ...)` (line 231) and before `app.get('/api/observations', ...)` (line 233), add:

```typescript
    app.post('/api/categories/restore-defaults', (c) => {
        const restored = restoreDefaultCategories();
        log('api', `Restored default categories (${restored} added)`);
        broadcast('counts:updated', {});
        return c.json({ restored });
    });
```

**Step 3: Commit**

```
feat: add restore-defaults API endpoints for domains and categories
```

---


### Task 3: Settings.tsx — Help text + AI generate explanation

**Files:**
- Modify: `src/ui/components/Settings.tsx:436-525` (AiGeneratePanel)
- Modify: `src/ui/components/Settings.tsx:739-805` (Domains/Categories tab content)

**Step 1: Add help text to Domains tab**

In Settings.tsx, inside the `<Show when={tab() === 'domains'}>` block (line 740), add a paragraph before the "Generate with AI" button div:

```tsx
<p class="text-xs text-neutral-500 mb-3 leading-relaxed">
    Domains organize memories by technical area (e.g. frontend, backend, data). When Claude saves a memory, it assigns a domain to help you filter and search later.
</p>
```

**Step 2: Add help text to Categories tab**

In the `<Show when={tab() === 'categories'}>` block (line 774), add the same pattern:

```tsx
<p class="text-xs text-neutral-500 mb-3 leading-relaxed">
    Categories classify the type of knowledge stored (e.g. decision, pattern, solution). They help distinguish why something was remembered.
</p>
```

**Step 3: Add AI generate explanation**

In `AiGeneratePanel` (line 448), inside the `<Show when={props.results.length === 0}>` block (line 464), add a one-liner below the heading div and above the `<div class="flex gap-2">`:

```tsx
<p class="text-[11px] text-purple-300/60 mb-2">
    Describe your project or use case and AI will suggest {props.type === 'domain' ? 'domains' : 'categories'} tailored to it. You can approve or reject each suggestion.
</p>
```

**Step 4: Commit**

```
feat: add help text to taxonomy tabs and AI generate panel
```

---


### Task 4: Settings.tsx — Unified delete with confirmation

**Files:**
- Modify: `src/ui/components/Settings.tsx:261-434` (TaxonomySection)

**Step 1: Rewrite delete logic in TaxonomySection**

Replace the `forceDeleteTarget` signal with `deleteTarget`:

```typescript
const [deleteTarget, setDeleteTarget] = createSignal<TaxonomyItem | null>(null);
```

Delete always goes through confirmation (prevent accidental deletion):

```typescript
const handleDelete = (item: TaxonomyItem) => {
    setDeleteTarget(item);
};
```

Replace `handleForceDelete` with `confirmDelete` — uses force endpoint when memories exist, regular endpoint otherwise:

```typescript
const confirmDelete = async () => {
    const item = deleteTarget();
    if (!item) return;
    const hasMemories = item.count > 0;
    const endpoint = props.type === 'domain'
        ? `/api/domains/${encodeURIComponent(item.name)}${hasMemories ? '/force' : ''}`
        : `/api/categories/${encodeURIComponent(item.name)}${hasMemories ? '/force' : ''}`;
    try {
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (res.ok) {
            if (hasMemories) {
                const data = await res.json();
                props.showToast(`Deleted ${props.type} "${item.name}" (${data.memoriesDeleted} memories removed)`);
            } else {
                props.showToast(`${props.type} "${item.name}" deleted`);
            }
            props.onRefresh();
        } else {
            const err = await res.json();
            props.showToast(err.error || 'Delete failed');
        }
    } catch {
        props.showToast('Delete failed');
    }
    setDeleteTarget(null);
};
```

**Step 2: Replace the two-button UI with a single button**

In the item row hover actions (lines 380-404), replace the trash + force-delete buttons with:

```tsx
<button
    onClick={() => handleDelete(item)}
    class="p-1 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400"
    title={item.count > 0 ? `Delete (will remove ${item.count} memories)` : 'Delete'}
>
    <i class="fa-solid fa-trash" style="font-size: 10px" />
</button>
```

Remove the `disabled` attribute logic and the `<Show when={item.count > 0}>` wrapper for the second button entirely.

**Step 3: Update the ConfirmModal**

Replace the existing ConfirmModal at the bottom of TaxonomySection (lines 424-432):

Different messaging depending on whether memories exist:

```tsx
<ConfirmModal
    open={!!deleteTarget()}
    title={`Delete ${props.type}`}
    message={
        (deleteTarget()?.count || 0) > 0
            ? `Delete ${props.type} "${deleteTarget()?.name}"? This will permanently remove ${deleteTarget()?.count} memories that use this ${props.type}.`
            : `Delete ${props.type} "${deleteTarget()?.name}"?`
    }
    confirmLabel={(deleteTarget()?.count || 0) > 0 ? 'Force Delete' : 'Delete'}
    confirmClass={(deleteTarget()?.count || 0) > 0
        ? 'text-sm px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300'
        : undefined
    }
    onConfirm={confirmDelete}
    onCancel={() => setDeleteTarget(null)}
/>
```

**Step 4: Commit**

```
feat: unified taxonomy delete with confirmation for items that have memories
```

---


### Task 5: Settings.tsx — Per-tab restore defaults footer

**Files:**
- Modify: `src/ui/components/Settings.tsx:527-830` (Settings component)

**Step 1: Add restore state signals**

In the Settings component, add after the AI generation state (around line 544):

```typescript
const [restoreConfirm, setRestoreConfirm] = createSignal<'config' | 'domains' | 'categories' | null>(null);
```

**Step 2: Add restore handlers**

After `closeAiPanel` function (~line 656), add:

```typescript
const handleRestoreConfig = () => {
    const defaults: Record<string, number> = {};
    for (const section of sections) {
        for (const field of section.fields) {
            defaults[field.key] = field.fallback;
        }
    }
    setConfig(defaults);
    setRestoreConfirm(null);
    props.showToast('Config reset to defaults — click Save & Restart to apply');
};

const handleRestoreTaxonomy = async (type: 'domains' | 'categories') => {
    try {
        const res = await fetch(`/api/${type}/restore-defaults`, { method: 'POST' });
        const data = await res.json();
        props.showToast(data.restored > 0 ? `Restored ${data.restored} default ${type}` : `All default ${type} already present`);
        refreshTaxonomy();
    } catch {
        props.showToast('Restore failed');
    }
    setRestoreConfirm(null);
};
```

**Step 3: Move footer outside the config-only Show**

Replace the current footer (lines 808-827) which is wrapped in `<Show when={tab() === 'config'}>`. Make it unconditional but with different content per tab:

```tsx
{/* Footer */}
<div class="flex items-center justify-between px-5 py-3 border-t border-neutral-700">
    <div>
        <button
            onClick={() => setRestoreConfirm(tab())}
            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
        >
            <i class="fa-solid fa-arrow-rotate-left" style="font-size: 11px"></i>
            Restore Defaults
        </button>
    </div>
    <div class="flex items-center gap-2">
        <button
            onClick={props.onClose}
            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
        >
            Cancel
        </button>
        <Show when={tab() === 'config'}>
            <button
                onClick={handleSave}
                disabled={saving()}
                class="px-3 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
                <Icon name="rotate-cw" size={12} class={saving() ? 'animate-spin' : ''} />
                {saving() ? 'Restarting...' : 'Save & Restart'}
            </button>
        </Show>
    </div>
</div>
```

**Step 4: Add restore ConfirmModal**

Before the closing `</Overlay>` tag, add:

```tsx
<ConfirmModal
    open={!!restoreConfirm()}
    title="Restore Defaults"
    message={
        restoreConfirm() === 'config'
            ? 'Reset all configuration values to their defaults? You will need to Save & Restart to apply.'
            : `Restore default ${restoreConfirm()}? This will add back any removed defaults but won't overwrite your changes.`
    }
    confirmLabel="Restore"
    onConfirm={() => {
        const t = restoreConfirm();
        if (t === 'config') handleRestoreConfig();
        else if (t === 'domains' || t === 'categories') handleRestoreTaxonomy(t);
    }}
    onCancel={() => setRestoreConfirm(null)}
/>
```

**Step 5: Commit**

```
feat: per-tab restore defaults in Settings modal
```

---


### Task 6: Observation sidebar overflow fixes

**Files:**
- Modify: `src/ui/App.tsx:418-430` (observation project header)
- Modify: `src/ui/components/ObservationCard.tsx:46-48` (card footer)

**Step 1: Fix observation project header overflow**

In `App.tsx`, the project header button around lines 418-430. Replace the inner content of the button:

```tsx
<button
    class="w-full mt-4 mb-2 px-2 py-1.5 rounded bg-neutral-800/60 border border-neutral-700/50 flex items-center gap-1.5 hover:bg-neutral-800 transition-colors min-w-0"
    onClick={() => toggleProject(`obs:${projPath}`)}
    title={projPath}
>
    <i class={`fa-solid ${projPath === '_global' ? 'fa-globe' : (projectIconMap()[projPath] || 'fa-folder-open')} text-purple-400 shrink-0`} style="font-size: 12px"></i>
    <span class="text-xs font-medium text-neutral-300 truncate min-w-0 flex-1">{shortPath(projPath)}</span>
    <span class="text-[10px] text-neutral-500 shrink-0">({obs.length})</span>
    <Icon name={collapsedProjects()[`obs:${projPath}`] ? 'chevron-right' : 'chevron-down'} size={10} class="text-neutral-500 shrink-0" />
</button>
```

Key changes: `min-w-0` on button, `truncate min-w-0 flex-1` on name, `shrink-0` on count and chevron, `title={projPath}` for full path tooltip.

**Step 2: Fix ObservationCard footer overflow**

In `ObservationCard.tsx`, replace lines 46-48:

```tsx
<div class="flex items-center justify-between text-[10px] text-neutral-600 gap-2">
    <span class="truncate min-w-0" title={`#${o.id} · ${shortPath(o.project_path)}`}>#{o.id} · {shortPath(o.project_path)}</span>
    <span class="shrink-0 whitespace-nowrap">{fmtDate(o.created_at)}</span>
</div>
```

Key changes: `gap-2` on flex container, `truncate min-w-0` on project span with `title`, `shrink-0 whitespace-nowrap` on date.

**Step 3: Commit**

```
fix: observation sidebar and card overflow — truncate paths, pin dates
```

---


### Task 7: Project delete button on memory/observation headers

**Files:**
- Modify: `src/ui/App.tsx:418-430` (observation project header — add delete button)
- Modify: `src/ui/App.tsx:462-482` (memory project header — add delete button)

**Step 1: Add delete button to observation project headers**

In the observation project header button (the one fixed in Task 6), we need to change it from a single `<button>` to a `<div>` with a nested toggle button and delete button. Replace the observation project header:

```tsx
<div class="w-full mt-4 mb-2 px-2 py-1.5 rounded bg-neutral-800/60 border border-neutral-700/50 flex items-center gap-1.5 hover:bg-neutral-800 transition-colors min-w-0 group/proj">
    <button
        class="flex items-center gap-1.5 min-w-0 flex-1"
        onClick={() => toggleProject(`obs:${projPath}`)}
        title={projPath}
    >
        <i class={`fa-solid ${projPath === '_global' ? 'fa-globe' : (projectIconMap()[projPath] || 'fa-folder-open')} text-purple-400 shrink-0`} style="font-size: 12px"></i>
        <span class="text-xs font-medium text-neutral-300 truncate min-w-0 flex-1 text-left">{shortPath(projPath)}</span>
        <span class="text-[10px] text-neutral-500 shrink-0">({obs.length})</span>
        <Icon name={collapsedProjects()[`obs:${projPath}`] ? 'chevron-right' : 'chevron-down'} size={10} class="text-neutral-500 shrink-0" />
    </button>
    <Show when={projPath !== '_global'}>
        <button
            onClick={(e) => {
                e.stopPropagation();
                const proj = (projects() || []).find((p: Project) => p.path === projPath);
                if (proj) setDeleteProjectTarget(proj);
            }}
            class="p-0.5 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0"
            title="Delete project"
        >
            <i class="fa-solid fa-trash" style="font-size: 9px"></i>
        </button>
    </Show>
</div>
```

**Step 2: Add delete button to memory project headers**

In the memory panel project header (around line 462-482), add a delete button inside the `<button>` row. Convert the project header to a `<div>` container with nested buttons:

```tsx
<div
    class="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-neutral-800/60 transition-colors group/proj"
>
    <button
        class="flex items-center gap-2 flex-1 min-w-0"
        onClick={() => toggleProject(projGroup.project)}
        title={projectDescMap()[projGroup.project] || projGroup.project}
    >
        <i class={`fa-solid ${projGroup.project === '_global' ? 'fa-globe' : (projectIconMap()[projGroup.project] || 'fa-folder-open')} text-sky-400`} style="font-size: 16px"></i>
        <div class="flex flex-col items-start min-w-0">
            <span class="text-sm font-bold text-neutral-200 truncate max-w-full">{shortPath(projGroup.project)}</span>
            <Show when={projectDescMap()[projGroup.project]}>
                <span class="text-[10px] text-neutral-500 leading-tight truncate max-w-full">{projectDescMap()[projGroup.project]}</span>
            </Show>
        </div>
        <span class="text-xs text-neutral-500 shrink-0">
            ({projGroup.domains.reduce((n, d) => n + d.categories.reduce((c, cat) => c + cat.memories.length, 0), 0)} memories)
        </span>
        <Icon name={collapsedProjects()[projGroup.project] ? 'chevron-right' : 'chevron-down'} size={12} class="text-neutral-500 shrink-0" />
    </button>
    <Show when={projGroup.project !== '_global'}>
        <button
            onClick={(e) => {
                e.stopPropagation();
                const proj = (projects() || []).find((p: Project) => p.path === projGroup.project);
                if (proj) setDeleteProjectTarget(proj);
            }}
            class="p-1 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0"
            title="Delete project"
        >
            <i class="fa-solid fa-trash" style="font-size: 10px"></i>
        </button>
    </Show>
</div>
```

**Step 3: Commit**

```
feat: add project delete button to memory and observation headers
```

---


### Task 8: Build and verify

**Step 1: Build**

Run: `cd ai-memory && pnpm build`
Expected: Clean build, no errors.

**Step 2: Kill existing server and restart**

```bash
kill $(lsof -t -i:24636) 2>/dev/null; sleep 1; cd ai-memory && node dist/server.js &
```

**Step 3: Verify in browser**

Open dashboard and check:
- Settings > Domains tab has help text
- Settings > Categories tab has help text
- AI Generate panel has explanation text
- Single delete button on taxonomy items, confirmation when memories exist
- Restore Defaults button on all three tabs
- Observation project headers truncate properly with count/chevron pinned right
- Observation card footer dates don't overflow
- Delete buttons appear on project headers (memory + observation) on hover

**Step 4: Commit**

```
chore: build settings ux polish
```
