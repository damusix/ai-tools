# Dashboard UX V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add project management, unified settings modal with tabs, AI-powered taxonomy generation, memory provenance, project enrichment, server stop, and improved transfer flow.

**Architecture:** All features build on existing SolidJS + Tailwind dashboard, Hono API routes, and better-sqlite3 database. New columns are added directly to the `CREATE TABLE` statements in `initSchema()` — no idempotent migrations needed since this is pre-release. AI features use Claude Haiku via `@anthropic-ai/claude-agent-sdk`. The Settings modal absorbs the Taxonomy modal as tabs. A one-time SQL script in `tmp/` handles the dev database migration.

**Tech Stack:** SolidJS, Tailwind CSS, Hono, better-sqlite3, Font Awesome 7, Claude Haiku

---


### Task 1: Add `reason` column to memories and `icon`/`description` columns to projects

**Files:**
- Modify: `src/db.ts`

**Step 1: Add `reason` column directly to the memories CREATE TABLE**

In `initSchema()`, modify the `CREATE TABLE memories` statement (~line 60) to include `reason`:

```typescript
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'fact',
    importance INTEGER NOT NULL DEFAULT 3
        CHECK(importance BETWEEN 1 AND 5),
    observation_ids TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

**Step 2: Add `icon` and `description` columns directly to the projects CREATE TABLE**

Modify the `CREATE TABLE projects` statement (~line 44):

```typescript
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'fa-folder-open',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

No idempotent migration guards needed — this is pre-release. A one-time dev migration SQL script is provided in Task 13.

**Step 3: Update `insertMemory` signature to accept `reason`**

Change `insertMemory` (~line 280) to add `reason` parameter:

```typescript
export function insertMemory(
    projectId: number,
    content: string,
    tags: string,
    category: string,
    importance: number,
    observationIds: string,
    domain?: string,
    reason?: string,
): number {
    const validCats = listCategoriesRaw();
    if (!validCats.some(c => c.name === category)) {
        throw new Error(`Invalid category: "${category}". Valid: ${validCats.map(c => c.name).join(', ')}`);
    }
    const db = getDb();
    const now = new Date().toISOString();
    const result = db
        .prepare(
            `INSERT INTO memories (project_id, content, tags, category, importance, observation_ids, domain, reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(projectId, content, tags, category, importance, observationIds, domain ?? null, reason ?? '', now, now);
    return Number(result.lastInsertRowid);
}
```

**Step 4: Update `updateMemory` signature to accept `reason`**

Change `updateMemory` (~line 306) similarly:

```typescript
export function updateMemory(
    id: number,
    content: string,
    tags: string,
    category: string,
    importance: number,
    observationIds: string,
    domain?: string,
    reason?: string,
): void {
    const validCats = listCategoriesRaw();
    if (!validCats.some(c => c.name === category)) {
        throw new Error(`Invalid category: "${category}". Valid: ${validCats.map(c => c.name).join(', ')}`);
    }
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
        `UPDATE memories SET content = ?, tags = ?, category = ?, importance = ?, observation_ids = ?, domain = ?, reason = ?, updated_at = ?
         WHERE id = ?`,
    ).run(content, tags, category, importance, observationIds, domain ?? null, reason ?? '', now, id);
}
```

**Step 5: Update `listProjects` to include icon and description**

Change the `listProjects` query (~line 217) to select the new columns:

```typescript
export function listProjects(): any[] {
    const db = getDb();
    return db.prepare(`
        SELECT p.id, p.path, p.name, p.icon, p.description, p.created_at,
            (SELECT COUNT(*) FROM observations WHERE project_id = p.id) as observation_count,
            (SELECT COUNT(*) FROM memories WHERE project_id = p.id) as memory_count
        FROM projects p
        ORDER BY p.name
    `).all();
}
```

**Step 6: Add `deleteProject` function**

After `getOrCreateProject()`, add:

```typescript
export function deleteProject(projectId: number): { memories: number; observations: number } {
    const db = getDb();
    const proj = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
    if (!proj) throw new Error(`Project ${projectId} not found`);
    if (proj.path === '_global') throw new Error('Cannot delete the global project');

    const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE project_id = ?').get(projectId) as any).c;
    const obsCount = (db.prepare('SELECT COUNT(*) as c FROM observations WHERE project_id = ?').get(projectId) as any).c;

    db.prepare('DELETE FROM observation_queue WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM memory_queue WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM memories WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM observations WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    return { memories: memCount, observations: obsCount };
}
```

**Step 7: Add `updateProjectMeta` function**

```typescript
export function updateProjectMeta(projectId: number, icon: string, description: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET icon = ?, description = ? WHERE id = ?').run(icon, description, projectId);
}
```

**Step 8: Add `forceDeleteTaxonomy` functions**

After `deleteDomain()` and `deleteCategory()`, add force-delete variants:

```typescript
export function forceDeleteDomain(name: string): number {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE domain = ?').get(name) as any).c;
    if (count > 0) {
        db.prepare("DELETE FROM memories WHERE domain = ?").run(name);
    }
    db.prepare('DELETE FROM domains WHERE name = ?').run(name);
    return count;
}

export function forceDeleteCategory(name: string): number {
    const db = getDb();
    const count = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE category = ?").get(name) as any).c;
    if (count > 0) {
        db.prepare("DELETE FROM memories WHERE category = ?").run(name);
    }
    db.prepare('DELETE FROM categories WHERE name = ?').run(name);
    return count;
}
```

**Step 9: Update memory query functions to include `reason`**

In `searchMemories` (~line 329), `listMemories`, and the memories API route, add `m.reason` to the SELECT column list. Find all `SELECT m.id, m.content, m.tags` patterns and add `m.reason` after `m.updated_at`.

**Step 10: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 11: Commit**

```bash
git add src/db.ts
git commit -m "feat: add reason to memories, icon/description to projects, deleteProject, forceDeleteTaxonomy"
```

---


### Task 2: Write tests for new DB functions

**Files:**
- Modify: `test/db.test.ts`

**Step 1: Add tests for deleteProject**

```typescript
describe('deleteProject', () => {
    it('deletes a project and all its data', () => {
        const proj = getOrCreateProject('/test/delete-me');
        insertMemory(proj.id, 'test', '', 'fact', 3, '');
        insertObservation(proj.id, 'obs', 'src');
        const result = deleteProject(proj.id);
        expect(result.memories).toBe(1);
        expect(result.observations).toBe(1);
        const all = listProjects();
        expect(all.find((p: any) => p.path === '/test/delete-me')).toBeUndefined();
    });

    it('throws when deleting _global', () => {
        const proj = getOrCreateProject('_global');
        expect(() => deleteProject(proj.id)).toThrow('Cannot delete the global project');
    });
});
```

**Step 2: Add tests for forceDeleteDomain**

```typescript
describe('forceDeleteDomain', () => {
    it('removes domain and nullifies memories', () => {
        insertDomain('temp-dom', 'temp', 'fa-folder');
        const proj = getOrCreateProject('/test/force-dom');
        insertMemory(proj.id, 'test', '', 'fact', 3, '', 'temp-dom');
        const cleared = forceDeleteDomain('temp-dom');
        expect(cleared).toBe(1);
        const doms = listDomainsRaw();
        expect(doms.find(d => d.name === 'temp-dom')).toBeUndefined();
    });
});
```

**Step 3: Add tests for forceDeleteCategory**

```typescript
describe('forceDeleteCategory', () => {
    it('removes category and migrates memories to fact', () => {
        insertCategory('temp-cat', 'temp', 'fa-folder');
        const proj = getOrCreateProject('/test/force-cat');
        insertMemory(proj.id, 'test', '', 'temp-cat', 3, '');
        const cleared = forceDeleteCategory('temp-cat');
        expect(cleared).toBe(1);
        const cats = listCategoriesRaw();
        expect(cats.find(c => c.name === 'temp-cat')).toBeUndefined();
    });
});
```

**Step 4: Add test for memory reason field**

```typescript
describe('memory reason', () => {
    it('stores and retrieves reason', () => {
        const proj = getOrCreateProject('/test/reason');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '1,2', undefined, 'Synthesized from 2 observations about routing');
        const mems = listMemories('/test/reason');
        const mem = mems.find((m: any) => m.id === id);
        expect(mem.reason).toBe('Synthesized from 2 observations about routing');
    });
});
```

**Step 5: Add test for project icon/description**

```typescript
describe('project enrichment', () => {
    it('updateProjectMeta sets icon and description', () => {
        const proj = getOrCreateProject('/test/enrich');
        updateProjectMeta(proj.id, 'fa-rocket', 'A rocket science project');
        const all = listProjects();
        const p = all.find((pr: any) => pr.path === '/test/enrich');
        expect(p.icon).toBe('fa-rocket');
        expect(p.description).toBe('A rocket science project');
    });
});
```

**Step 6: Run tests**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && mkdir -p tmp && pnpm vitest run test/db.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add test/db.test.ts
git commit -m "test: add tests for deleteProject, forceDeleteTaxonomy, reason, project meta"
```

---


### Task 3: Add API endpoints for new features

**Files:**
- Modify: `src/app.ts`

**Step 1: Add imports**

Add to the import block from `./db.js`:

```typescript
import {
    // ... existing ...
    deleteProject,
    updateProjectMeta,
    forceDeleteDomain,
    forceDeleteCategory,
} from './db.js';
```

**Step 2: Add DELETE project endpoint**

After the existing `GET /api/projects` route, add:

```typescript
app.delete('/api/projects/:id', (c) => {
    const id = Number(c.req.param('id'));
    try {
        const result = deleteProject(id);
        log('api', `Project ${id} deleted (${result.memories} memories, ${result.observations} observations)`);
        broadcast('counts:updated', {});
        return c.json({ deleted: true, ...result });
    } catch (err: any) {
        return c.json({ error: err.message }, 400);
    }
});
```

**Step 3: Add PUT project meta endpoint**

```typescript
app.put('/api/projects/:id/meta', async (c) => {
    const id = Number(c.req.param('id'));
    const { icon, description } = await c.req.json();
    updateProjectMeta(id, icon, description);
    log('api', `Project ${id} meta updated`);
    return c.json({ updated: true });
});
```

**Step 4: Add force-delete endpoints for taxonomy**

After the existing DELETE domain/category routes, add:

```typescript
app.delete('/api/domains/:name/force', (c) => {
    const name = c.req.param('name');
    const deleted = forceDeleteDomain(name);
    log('api', `Domain "${name}" force-deleted (${deleted} memories deleted)`);
    broadcast('counts:updated', {});
    return c.json({ deleted: true, memoriesDeleted: deleted });
});

app.delete('/api/categories/:name/force', (c) => {
    const name = c.req.param('name');
    const deleted = forceDeleteCategory(name);
    log('api', `Category "${name}" force-deleted (${deleted} memories deleted)`);
    broadcast('counts:updated', {});
    return c.json({ deleted: true, memoriesDeleted: deleted });
});
```

**Step 5: Add stop server endpoint**

After the existing restart endpoint, add:

```typescript
app.post('/api/stop', (c) => {
    log('server', 'Stop requested — server will shut down');
    setTimeout(() => {
        process.exit(0);
    }, getConfig().server.restartDelayMs);
    return c.json({ stopping: true });
});
```

**Step 6: Add AI taxonomy generation endpoint**

```typescript
app.post('/api/taxonomy/generate', async (c) => {
    const { type, prompt: userPrompt } = await c.req.json();
    if (!type || !userPrompt) return c.json({ error: 'type and prompt required' }, 400);

    const existing = type === 'domain'
        ? listDomainsRaw().map(d => d.name).join(', ')
        : listCategoriesRaw().map(c => c.name).join(', ');

    const systemPrompt = `You generate taxonomy items for a memory management system.
The user wants to create ${type}s. Existing ${type}s: ${existing}

Return ONLY a JSON array of objects with: name (lowercase, kebab-case), description (1 sentence), icon (Font Awesome class like "fa-rocket").
Generate 3-8 items. Do not duplicate existing ${type}s.`;

    try {
        const { AnthropicClient } = await import('@anthropic-ai/claude-agent-sdk');
        const client = new AnthropicClient();
        const response = await client.message({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        });
        const text = response.content.find((b: any) => b.type === 'text')?.text || '[]';
        const match = text.match(/\[[\s\S]*\]/);
        const items = match ? JSON.parse(match[0]) : [];
        return c.json({ items });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});
```

Note: The AI generation endpoint's exact import/SDK usage should match the existing pattern used in `src/worker.ts`. Inspect how `synthesizeMemories` creates its Claude client and replicate that pattern — the code above is pseudocode for the LLM call. The key structure (system prompt + user prompt -> JSON array of `{ name, description, icon }`) is what matters.

**Step 7: Add multi-transfer endpoint**

After the existing transfer endpoint, add a batch variant:

```typescript
app.post('/api/projects/transfer-batch', async (c) => {
    const { targetPath, sourcePaths } = await c.req.json();
    if (!targetPath || !Array.isArray(sourcePaths) || sourcePaths.length === 0) {
        return c.json({ error: 'targetPath and sourcePaths[] required' }, 400);
    }

    const results = [];
    for (const fromPath of sourcePaths) {
        try {
            const result = transferProject(fromPath, targetPath);
            results.push({ from: fromPath, ...result });
        } catch (err: any) {
            results.push({ from: fromPath, error: err.message });
        }
    }

    broadcast('counts:updated', {});
    return c.json({ results });
});
```

**Step 8: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 9: Commit**

```bash
git add src/app.ts
git commit -m "feat: API endpoints for project delete, stop, force-delete taxonomy, AI generate, batch transfer"
```

---


### Task 4: Update worker to pass `reason` and project description when creating/updating memories

**Files:**
- Modify: `src/worker.ts`
- Modify: `src/prompts/synthesize-memories.md`

**Step 1: Inject project description into the synthesis prompt**

In `src/prompts/synthesize-memories.md`, add a `PROJECT` section at the top (before DOMAINS):

```markdown
PROJECT:
{{PROJECT}}

DOMAINS (assign exactly one to each memory):
{{DOMAINS}}
```

In `processMemoryQueue()` in `worker.ts`, after fetching the project path (~line 222), also fetch the project description and pass it as a template variable:

```typescript
const project = db.prepare('SELECT path, description FROM projects WHERE id = ?').get(item.project_id) as any;
const projectContext = project.description
    ? `${project.path} — ${project.description}`
    : project.path;
```

Then in the `loadPrompt` call for `synthesize-memories`, add `PROJECT: projectContext`.

This gives the LLM context about what the project is, so it generates more relevant memories. Project descriptions are stable (they describe what the project *is*, not what's currently being worked on) and get auto-generated once a project has 5+ memories (Task 11).

**Step 2: Update the LLM prompt to request `reason`**

In `src/prompts/synthesize-memories.md`, add `reason` to the output schema:

```markdown
Return ONLY a JSON object like:
{
    "creates": [
        {"content": "memory text", "domain": "frontend", "tags": ["tag1", "tag2"], "category": "decision", "importance": 3, "observation_ids": [1, 2], "reason": "Brief explanation of why this memory was created"}
    ],
    "updates": [
        {"id": 5, "content": "updated memory text", "domain": "frontend", "tags": ["tag1"], "category": "pattern", "importance": 4, "observation_ids": [3, 4], "reason": "Brief explanation of what changed and why"}
    ]
}
```

Add to the Rules section:

```markdown
- Every memory MUST have a reason explaining why it was created or updated (e.g. "Observed consistent pattern of using React Router v6 across 3 sessions", "Updated with new routing convention discovered in observation")
```

**Step 2: Pass `reason` in worker memory creation**

In `processMemoryQueue()` (~line 228), update the `insertMemory` call:

```typescript
for (const mem of result.creates || []) {
    insertMemory(
        item.project_id,
        mem.content,
        (mem.tags || []).join(','),
        mem.category || 'fact',
        mem.importance || 3,
        (mem.observation_ids || []).join(','),
        mem.domain || 'general',
        mem.reason || 'Synthesized from observations',
    );
    processedObsIds.push(...(mem.observation_ids || []));
}
```

And the `updateMemory` call (~line 241):

```typescript
for (const mem of result.updates || []) {
    updateMemory(
        mem.id,
        mem.content,
        (mem.tags || []).join(','),
        mem.category || 'fact',
        mem.importance || 3,
        mem.observation_ids?.join(',') || '',
        mem.domain || 'general',
        mem.reason || 'Updated from new observations',
    );
    processedObsIds.push(...(mem.observation_ids || []));
}
```

**Step 3: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 4: Run tests**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && mkdir -p tmp && pnpm vitest run test/db.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/worker.ts src/prompts/synthesize-memories.md
git commit -m "feat: worker passes reason to memory create/update, prompt requests reason field"
```

---


### Task 5: Update MCP tools and memory type for `reason`

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/ui/App.tsx` (Memory type)

**Step 1: Update `save_memory` tool to accept `reason`**

In `src/tools.ts`, add `reason` to the `save_memory` input schema:

```typescript
reason: z.string().optional().describe('Why this memory is being saved'),
```

And pass it through to `insertMemory()`.

**Step 2: Update Memory type in App.tsx**

Add `reason` to the Memory type (~line 13):

```typescript
export type Memory = {
    id: number;
    content: string;
    tags: string;
    category: string;
    importance: number;
    domain: string | null;
    reason: string;
    created_at: string;
    updated_at: string;
    project_path: string;
};
```

**Step 3: Update Project type in App.tsx**

Add `icon` and `description` (~line 34):

```typescript
export type Project = {
    id: number;
    path: string;
    name: string;
    icon: string;
    description: string;
    created_at: string;
    observation_count: number;
    memory_count: number;
};
```

**Step 4: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 5: Commit**

```bash
git add src/tools.ts src/ui/App.tsx
git commit -m "feat: add reason to MCP save_memory tool, update Memory/Project types"
```

---


### Task 6: Add stop button to header and show `reason` on MemoryCard

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/components/MemoryCard.tsx`

**Step 1: Add stop button to App.tsx header**

In the header toolbar, next to the restart button, add a stop button:

```tsx
<button
    onClick={handleStop}
    disabled={stopping()}
    class="px-2 py-1.5 text-xs rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 disabled:opacity-50 transition-colors flex items-center"
    title="Stop the ai-memory server"
>
    <i class="fa-solid fa-stop" style="font-size: 14px"></i>
</button>
```

Add signal and handler:

```typescript
const [stopping, setStopping] = createSignal(false);

const handleStop = async () => {
    setStopping(true);
    try {
        await fetch('/api/stop', { method: 'POST' });
        showToast('Server stopping...');
    } catch {
        showToast('Stop failed');
    } finally {
        setStopping(false);
    }
};
```

This should be behind a confirmation. Use the existing `ConfirmModal` pattern — add a `stopConfirm` signal:

```typescript
const [stopConfirm, setStopConfirm] = createSignal(false);
```

The button sets `setStopConfirm(true)` instead of calling `handleStop` directly. Add a `ConfirmModal` for it at the bottom. The message: `"Stop the server? It will restart automatically with your next Claude Code session."`

But `ConfirmModal` currently only has a "Delete" button label. We need to make it more flexible. See Task 8 for the modal upgrade — use the updated `ConfirmModal` with a `confirmLabel` prop here.

**Step 2: Show reason on MemoryCard**

In `MemoryCard.tsx`, add a `reason` display below the content and above the tags, when reason exists:

```tsx
<Show when={m.reason}>
    <p class="text-[11px] text-neutral-500 italic mt-1 flex items-center gap-1">
        <i class="fa-solid fa-circle-info" style="font-size: 10px"></i>
        {m.reason}
    </p>
</Show>
```

Place this right after the content `<p>` tag (~after line 49).

**Step 3: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/ui/App.tsx src/ui/components/MemoryCard.tsx
git commit -m "feat: add stop button with confirmation, show memory reason on cards"
```

---


### Task 7: Add project delete with confirmation

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/components/ProjectSelector.tsx`

**Step 1: Add delete button to ProjectSelector**

Read the current `ProjectSelector.tsx` fully. Add a small delete (x) button next to each project option. When clicked, it calls an `onDelete(id)` callback prop instead of selecting the project.

One approach: convert from a `<select>` dropdown to a custom dropdown component that shows projects with delete buttons. Or simpler: add a delete icon button next to the select.

The simpler approach for now: add an `onDelete` prop to `ProjectSelector`. Show a small trash icon next to the current project selector when a non-global project is selected:

```tsx
<Show when={props.selected && props.selected !== '_global'}>
    <button
        onClick={() => props.onDeleteProject?.()}
        class="px-1.5 py-1.5 text-neutral-500 hover:text-red-400 rounded hover:bg-red-400/10 transition-colors"
        title="Delete this project"
    >
        <Icon name="x" size={12} />
    </button>
</Show>
```

**Step 2: Wire delete in App.tsx**

Add a `deleteProjectConfirm` signal. When the delete button is clicked, store the project info and show a confirm modal.

```typescript
const [deleteProjectTarget, setDeleteProjectTarget] = createSignal<Project | null>(null);

const confirmDeleteProject = async () => {
    const target = deleteProjectTarget();
    if (!target) return;
    try {
        const res = await api<{ memories: number; observations: number }>(
            `/api/projects/${target.id}`,
            { method: 'DELETE' },
        );
        showToast(`Deleted project "${shortPath(target.path)}" (${res.memories} memories, ${res.observations} observations)`);
        selectProject(''); // Clear selection
        refresh();
    } catch {
        showToast('Delete failed');
    }
    setDeleteProjectTarget(null);
};
```

Add a ConfirmModal at the bottom for project deletion. Use the upgraded `ConfirmModal` (from Task 8) with a descriptive message:

`Delete project "${shortPath(target.path)}"? This will permanently delete ${target.memory_count} memories and ${target.observation_count} observations.`

**Step 3: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/ui/App.tsx src/ui/components/ProjectSelector.tsx
git commit -m "feat: project deletion with confirmation modal"
```

---


### Task 8: Upgrade ConfirmModal and Overlay for nested modals

**Files:**
- Modify: `src/ui/components/Modal.tsx`
- Modify: `src/ui/components/Overlay.tsx`

**Step 1: Upgrade ConfirmModal**

Add optional `confirmLabel`, `confirmClass`, and `title` props:

```typescript
export const ConfirmModal: Component<{
    open: boolean;
    message: string;
    title?: string;
    confirmLabel?: string;
    confirmClass?: string;
    onConfirm: () => void;
    onCancel: () => void;
}> = (props) => {
    return (
        <Overlay open={props.open} onClose={props.onCancel} zIndex={60}>
            <div class="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl">
                <Show when={props.title}>
                    <h3 class="text-sm font-semibold text-neutral-200 mb-2">{props.title}</h3>
                </Show>
                <p class="text-sm text-neutral-300 mb-4">{props.message}</p>
                <div class="flex justify-end gap-3">
                    <button
                        class="text-sm px-3 py-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                        onClick={props.onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        class={props.confirmClass || "text-sm px-3 py-1.5 rounded bg-red-500/10 text-red-400/80 hover:bg-red-500/20 hover:text-red-300"}
                        onClick={props.onConfirm}
                    >
                        {props.confirmLabel || 'Delete'}
                    </button>
                </div>
            </div>
        </Overlay>
    );
};
```

**Step 2: Add `zIndex` prop to Overlay**

Update Overlay to accept an optional `zIndex` prop (default 50):

```typescript
const Overlay: Component<{
    open: boolean;
    onClose?: () => void;
    zIndex?: number;
    children: JSX.Element;
}> = (props) => {
    // ...
    <div
        class="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center"
        style={{ 'z-index': props.zIndex ?? 50 }}
        // ...
    >
```

This allows confirm modals (z-60) to stack on top of settings/taxonomy modals (z-50).

**Step 3: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/ui/components/Modal.tsx src/ui/components/Overlay.tsx
git commit -m "feat: upgrade ConfirmModal with configurable labels, nested z-index support"
```

---


### Task 9: Unified Settings modal with tabs (Configuration + Domains + Categories)

**Files:**
- Rewrite: `src/ui/components/Settings.tsx`
- Delete content from: `src/ui/components/Taxonomy.tsx` (re-export from Settings or keep as sub-component)
- Modify: `src/ui/App.tsx`

**Step 1: Redesign Settings.tsx with tabs**

The unified Settings modal has 3 tabs:
- **Configuration** — the existing number fields grid (Worker, Context, Server, API sections)
- **Domains** — the existing TaxonomySection for domains, plus "Generate with AI" button
- **Categories** — the existing TaxonomySection for categories, plus "Generate with AI" button

Structure:

```tsx
const Settings: Component<{
    open: boolean;
    onClose: () => void;
    showToast: (msg: string) => void;
}> = (props) => {
    const [tab, setTab] = createSignal<'config' | 'domains' | 'categories'>('config');
    // ... existing config state ...
    // ... taxonomy data fetching ...

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col"
                 onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div class="px-5 py-4 border-b border-neutral-700">
                    <div class="flex items-center justify-between mb-3">
                        <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                            <Icon name="gear" size={14} class="text-sky-400" />
                            Settings
                        </h2>
                        <button onClick={props.onClose} class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800">
                            <Icon name="x" size={14} />
                        </button>
                    </div>
                    {/* Tabs */}
                    <div class="flex gap-1">
                        <For each={[
                            { id: 'config', label: 'Configuration', icon: 'fa-sliders' },
                            { id: 'domains', label: 'Domains', icon: 'fa-layer-group' },
                            { id: 'categories', label: 'Categories', icon: 'fa-tags' },
                        ] as const}>
                            {(t) => (
                                <button
                                    class={`px-3 py-1.5 text-xs rounded-t flex items-center gap-1.5 transition-colors ${
                                        tab() === t.id
                                            ? 'bg-neutral-800 text-sky-400 border border-neutral-700 border-b-transparent -mb-px'
                                            : 'text-neutral-500 hover:text-neutral-300'
                                    }`}
                                    onClick={() => setTab(t.id)}
                                >
                                    <i class={`fa-solid ${t.icon}`} style="font-size: 11px"></i>
                                    {t.label}
                                </button>
                            )}
                        </For>
                    </div>
                </div>

                {/* Tab content */}
                <div class="flex-1 overflow-y-auto px-5 py-4">
                    <Show when={tab() === 'config'}>
                        {/* Existing config sections grid */}
                    </Show>
                    <Show when={tab() === 'domains'}>
                        {/* TaxonomySection type="domain" + AI generate button */}
                    </Show>
                    <Show when={tab() === 'categories'}>
                        {/* TaxonomySection type="category" + AI generate button */}
                    </Show>
                </div>

                {/* Footer — only show Save & Restart on config tab */}
                <Show when={tab() === 'config'}>
                    <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-700">
                        {/* Cancel + Save & Restart buttons */}
                    </div>
                </Show>
            </div>
        </Overlay>
    );
};
```

**Step 2: Move taxonomy data fetching into Settings**

Move the domain/category fetching logic from the old Taxonomy component into Settings. The TaxonomySection sub-component stays in Taxonomy.tsx (or moves into Settings.tsx — implementer's choice for cleanliness).

**Step 3: Add AI Generate button to each taxonomy tab**

In each taxonomy tab, above the TaxonomySection, add:

```tsx
<div class="flex items-center gap-2 mb-3">
    <button
        onClick={() => setAiPromptMode('domain')}
        class="px-3 py-1.5 text-xs rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1.5"
    >
        <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 12px"></i>
        Generate with AI
    </button>
</div>
```

This opens an inline form: a textarea for the user to describe what they want, and Submit/Cancel buttons. On submit, call `POST /api/taxonomy/generate`. Display the AI results as a preview list — each item has an approve (checkmark) or reject (x) button. Approved items get created via the existing POST endpoints.

**Step 4: Add force-delete to TaxonomySection**

Update the delete logic in TaxonomySection. When count > 0:
- Show a dropdown or two-option menu: "Delete" (disabled, greyed) and "Force Delete" (red, enabled)
- Force delete shows a ConfirmModal (z-60, stacks over Settings z-50) with message:
  `"Force delete domain 'frontend'? This will permanently delete ${count} memories."`
  or for categories: `"Force delete category 'pattern'? This will permanently delete ${count} memories."`
- On confirm, call `DELETE /api/domains/{name}/force` or `DELETE /api/categories/{name}/force`

**Step 5: Remove the standalone Taxonomy modal from App.tsx**

In `App.tsx`:
- Remove the `taxonomyOpen` signal and state
- Remove the Taxonomy button from the header
- Remove the `<Taxonomy>` component render
- Remove the import of Taxonomy (if it's no longer used directly)

The Settings gear button now opens the unified modal. The Taxonomy content lives under the Domains/Categories tabs.

**Step 6: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 7: Commit**

```bash
git add src/ui/components/Settings.tsx src/ui/components/Taxonomy.tsx src/ui/App.tsx
git commit -m "feat: unified Settings modal with Configuration/Domains/Categories tabs, AI generation, force-delete"
```

---


### Task 10: Redesign TransferModal with target-first, multi-select flow

**Files:**
- Rewrite: `src/ui/components/TransferModal.tsx`
- Modify: `src/ui/App.tsx` (update onTransfer callback)

**Step 1: Rewrite TransferModal**

New flow:
1. **Target project** (first question): dropdown of existing projects + "New project" option
2. **Source projects** (second question): multi-select checklist of all other projects (excluding target and _global)
3. Submit calls `POST /api/projects/transfer-batch`

```tsx
const TransferModal: Component<{
    open: boolean;
    projects: Project[];
    onClose: () => void;
    onTransfer: (targetPath: string, sourcePaths: string[]) => Promise<void>;
}> = (props) => {
    const [targetMode, setTargetMode] = createSignal<'existing' | 'new'>('existing');
    const [targetExisting, setTargetExisting] = createSignal('');
    const [targetNew, setTargetNew] = createSignal('');
    const [selectedSources, setSelectedSources] = createSignal<Record<string, boolean>>({});
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal('');

    const targetPath = () => targetMode() === 'existing' ? targetExisting() : targetNew().trim();

    const sourcePaths = () => Object.entries(selectedSources())
        .filter(([, v]) => v)
        .map(([k]) => k);

    const availableSources = () => props.projects.filter(
        p => p.path !== '_global' && p.path !== targetPath()
    );

    const toggleSource = (path: string) => {
        setSelectedSources(prev => ({ ...prev, [path]: !prev[path] }));
    };

    const valid = () => targetPath() && sourcePaths().length > 0;

    // Target section: existing dropdown + "New" tab
    // Source section: scrollable checklist with checkboxes, shows memory/observation counts
    // Submit button: "Transfer N projects → target"
};
```

**Step 2: Update App.tsx transfer handler**

Change the `onTransfer` prop to match the new batch signature:

```typescript
onTransfer={async (targetPath, sourcePaths) => {
    const res = await fetch('/api/projects/transfer-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath, sourcePaths }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transfer failed');
    const total = data.results.reduce((acc: any, r: any) => ({
        memories: acc.memories + (r.memories || 0),
        observations: acc.observations + (r.observations || 0),
    }), { memories: 0, observations: 0 });
    showToast(`Transferred ${total.memories} memories, ${total.observations} observations from ${sourcePaths.length} project(s)`);
    refresh();
}}
```

**Step 3: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/ui/components/TransferModal.tsx src/ui/App.tsx
git commit -m "feat: redesign transfer flow — target-first, multi-select sources, batch API"
```

---


### Task 11: Add project auto-enrichment in worker

**Files:**
- Modify: `src/worker.ts`
- Create: `src/prompts/project-enrich.md`

**Step 1: Create the enrichment prompt**

Create `src/prompts/project-enrich.md`:

```markdown
You are analyzing a software project based on its stored memories. Generate a brief description and choose an appropriate Font Awesome icon.

PROJECT PATH: {{PROJECT_PATH}}

MEMORIES (sample):
{{MEMORIES}}

Return ONLY a JSON object:
{
    "description": "One sentence describing what this project is about",
    "icon": "fa-icon-name"
}

Rules:
- Description should be 1 sentence, max 100 characters
- Icon must be a Font Awesome solid icon class (e.g. "fa-rocket", "fa-code", "fa-store")
- Choose an icon that represents the project's primary focus
- Common choices: fa-code (generic coding), fa-globe (web app), fa-mobile (mobile), fa-server (backend), fa-robot (AI/ML), fa-store (e-commerce), fa-graduation-cap (education), fa-gamepad (gaming)
```

**Step 2: Add enrichment function to worker**

In `worker.ts`, add a function that checks for un-enriched projects with 5+ memories:

```typescript
async function enrichProjects(): Promise<void> {
    const db = getDb();
    const candidates = db.prepare(`
        SELECT p.id, p.path, p.icon, p.description,
            (SELECT COUNT(*) FROM memories WHERE project_id = p.id) as mem_count
        FROM projects p
        WHERE p.path != '_global'
          AND p.description = ''
          AND (SELECT COUNT(*) FROM memories WHERE project_id = p.id) >= 5
    `).all() as { id: number; path: string; mem_count: number }[];

    for (const proj of candidates) {
        try {
            const memories = listMemories(proj.path, undefined, undefined, 10);
            const prompt = loadPrompt('project-enrich', {
                PROJECT_PATH: proj.path,
                MEMORIES: JSON.stringify(memories.map((m: any) => ({
                    content: m.content, domain: m.domain, category: m.category,
                })), null, 2),
            });
            // Call Claude Haiku (same pattern as synthesizeMemories)
            // Parse JSON response for { description, icon }
            // Call updateProjectMeta(proj.id, result.icon, result.description)
            log('worker', `Enriched project ${proj.path}: ${result.description}`);
        } catch (err) {
            logError('worker', `Failed to enrich project ${proj.path}: ${err}`);
        }
    }
}
```

**Step 3: Call enrichment in the poll loop**

In `startWorker()`, call `enrichProjects()` occasionally (not every tick — every 10th tick or after synthesis):

```typescript
let pollCount = 0;
setInterval(async () => {
    // ... existing logic ...
    pollCount++;
    if (pollCount % 10 === 0) {
        await enrichProjects();
    }
}, getConfig().worker.pollIntervalMs);
```

**Step 4: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 5: Commit**

```bash
git add src/worker.ts src/prompts/project-enrich.md
git commit -m "feat: auto-enrich projects with AI description and icon after 5 memories"
```

---


### Task 12: Show project icons and descriptions in the dashboard

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/components/ProjectSelector.tsx`

**Step 1: Update project display in memory grouping**

In App.tsx, where project headers are rendered (the collapsible project rows), replace the generic folder icon with the project's icon:

```tsx
<i class={`fa-solid ${projGroup.project === '_global' ? 'fa-globe' : (projectIconMap()[projGroup.project] || 'fa-folder-open')}`}
   style="font-size: 16px" class="text-sky-400"></i>
```

Create a `projectIconMap` memo from the projects resource:

```typescript
const projectIconMap = createMemo(() => {
    const map: Record<string, string> = {};
    for (const p of projects() || []) map[p.path] = p.icon;
    return map;
});

const projectDescMap = createMemo(() => {
    const map: Record<string, string> = {};
    for (const p of projects() || []) map[p.path] = p.description;
    return map;
});
```

Optionally show description as a tooltip or small subtitle under the project name.

**Step 2: Update ProjectSelector to show icons**

If ProjectSelector is a `<select>` dropdown, icons can't be shown. If converting to a custom dropdown is desired, do so. Otherwise, keep simple and just ensure the icon shows in the project header rows of the memory panel.

**Step 3: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/ui/App.tsx src/ui/components/ProjectSelector.tsx
git commit -m "feat: display project icons and descriptions in dashboard"
```

---


### Task 13: Write dev migration script and final verification

**Files:**
- Create: `tmp/migrate-v2.sql`

**Step 1: Write the dev migration script**

This is a one-time script to add new columns to an existing dev database. Since this is pre-release, it can be destructive — the user backs up first.

```sql
-- Backup: cp ~/.ai-memory/ai-memory.db ~/.ai-memory/ai-memory.db.bak
-- Usage: sqlite3 ~/.ai-memory/ai-memory.db < tmp/migrate-v2.sql

-- Add reason column to memories
ALTER TABLE memories ADD COLUMN reason TEXT NOT NULL DEFAULT '';

-- Add icon and description columns to projects
ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'fa-folder-open';
ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
```

If columns already exist (from a fresh DB created by the new code), these will error — that's fine, just skip.

**Step 2: Also while in Task 1, clean up existing idempotent migrations**

The existing `initSchema()` has `PRAGMA table_info` migration guards for the `domain` column on memories and `icon` column on domains. Since this is pre-release, fold those directly into the `CREATE TABLE` statements and remove the migration blocks. The dev migration scripts (`tmp/migrate-remove-check.sql` from the previous plan) handle existing databases.

**Step 3: Full build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile, no warnings

**Step 4: Full test suite**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && mkdir -p tmp && pnpm vitest run test/db.test.ts`
Expected: ALL PASS

**Step 5: Do NOT commit the migration** — it's in `tmp/` which is gitignored.
