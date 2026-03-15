# Memory Detail Modal Implementation Plan


> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a memory detail modal with in-place editing, dirty tracking, and URL routing.

**Architecture:** New `MemoryDetailModal.tsx` component renders a two-column modal (content+tags left, metadata sidebar right). Backend adds GET/PUT endpoints for single memory access. Contenteditable fields with dirty tracking drive an Update button. URL routing via `?memory=<id>` follows the existing pushState/popstate pattern.

**Tech Stack:** SolidJS, Tailwind CSS, Hono, better-sqlite3, Font Awesome

**Spec:** `docs/superpowers/specs/2026-03-15-memory-detail-modal-design.md`

---


### Task 1: Backend — Add `getMemoryById()` and include `observation_ids` in `listMemories()`

**Files:**
- Modify: `src/db.ts:505-555` (listMemories SELECT)
- Modify: `src/db.ts` (add getMemoryById near listMemories)

- [ ] **Step 1: Add `observation_ids` to `listMemories()` SELECT**

In `src/db.ts:545`, change the SELECT to include `m.observation_ids`:

```typescript
    let sql = `
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain, m.created_at, m.updated_at, m.reason, m.observation_ids, p.path as project_path
        FROM memories m
        JOIN projects p ON m.project_id = p.id
        ${where}
        ORDER BY m.importance DESC, m.created_at DESC
    `;
```

Also add `m.observation_ids` to the SELECT in `searchMemories()` at `src/db.ts:396` and `searchMemoriesFuzzy()` at `src/db.ts:455`.

- [ ] **Step 2: Add `getMemoryById()` function**

Add after `listMemories()` (around line 556):

```typescript
export function getMemoryById(id: number): any | null {
    const db = getDb();
    return db.prepare(`
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain,
               m.created_at, m.updated_at, m.reason, m.observation_ids, p.path as project_path
        FROM memories m
        JOIN projects p ON m.project_id = p.id
        WHERE m.id = ?
    `).get(id) ?? null;
}
```

- [ ] **Step 3: Export `getMemoryById` from db.ts**

Add `getMemoryById` to the existing exports. It's already exported via the function declaration.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/`
Expected: All 100 tests pass (no behavior change, just broader SELECT)

- [ ] **Step 5: Commit**

```bash
git add src/db.ts
git commit -m "feat: add getMemoryById and observation_ids to memory queries"
```

---


### Task 2: Backend — Add GET and PUT memory endpoints

**Files:**
- Modify: `src/app.ts:7-36` (imports)
- Modify: `src/app.ts` (add routes near existing memory routes ~line 143)

- [ ] **Step 1: Add import for `getMemoryById` and `updateMemory`**

In `src/app.ts`, add `getMemoryById` and `updateMemory` to the import from `./db.js`:

```typescript
import {
    // ... existing imports ...
    getMemoryById,
    updateMemory,
} from './db.js';
```

- [ ] **Step 2: Add `GET /api/memories/:id` endpoint**

Add after the existing `app.delete('/api/memories/:id', ...)` route:

```typescript
    app.get('/api/memories/:id', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        if (isNaN(id)) return c.json({ error: 'Invalid memory ID' }, 400);
        const memory = getMemoryById(id);
        if (!memory) return c.json({ error: 'Memory not found' }, 404);
        return c.json(memory);
    });
```

- [ ] **Step 3: Add `PUT /api/memories/:id` endpoint**

Add after the GET route:

```typescript
    app.put('/api/memories/:id', async (c) => {
        const id = parseInt(c.req.param('id'), 10);
        if (isNaN(id)) return c.json({ error: 'Invalid memory ID' }, 400);
        const existing = getMemoryById(id);
        if (!existing) return c.json({ error: 'Memory not found' }, 404);
        const body = await c.req.json();
        const content = body.content ?? existing.content;
        const tags = body.tags ?? existing.tags;
        const category = body.category ?? existing.category;
        const importance = body.importance ?? existing.importance;
        const domain = body.domain !== undefined ? body.domain : existing.domain;
        try {
            updateMemory(id, content, tags, category, importance, existing.observation_ids, domain, existing.reason);
        } catch (e: any) {
            return c.json({ error: e.message }, 400);
        }
        const updated = getMemoryById(id);
        log('api', `Memory ${id} updated`);
        broadcast('memory:updated', updated);
        return c.json(updated);
    });
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app.ts
git commit -m "feat: add GET and PUT /api/memories/:id endpoints"
```

---


### Task 3: Backend — Tests for new endpoints

**Files:**
- Modify: `test/api.test.ts`

- [ ] **Step 1: Write tests for GET /api/memories/:id**

Add to the existing `describe('API', ...)` block in `test/api.test.ts`:

```typescript
    it('GET /api/memories/:id returns a memory', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('test-proj');
        const memId = insertMemory(proj.id, 'test content', 'tag1,tag2', 'fact', 3, '1,2', 'frontend');
        const res = await app.request(`/api/memories/${memId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.content).toBe('test content');
        expect(data.observation_ids).toBe('1,2');
        expect(data.project_path).toBe('test-proj');
    });

    it('GET /api/memories/:id returns 404 for missing memory', async () => {
        const app = makeApp();
        const res = await app.request('/api/memories/99999');
        expect(res.status).toBe(404);
    });

    it('GET /api/memories/:id returns 400 for invalid ID', async () => {
        const app = makeApp();
        const res = await app.request('/api/memories/abc');
        expect(res.status).toBe(400);
    });
```

- [ ] **Step 2: Write tests for PUT /api/memories/:id**

```typescript
    it('PUT /api/memories/:id updates fields', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('test-proj');
        const memId = insertMemory(proj.id, 'old content', 'old-tag', 'fact', 2, '1', 'frontend');
        const res = await req(app, 'PUT', `/api/memories/${memId}`, {
            content: 'new content',
            tags: 'new-tag',
            importance: 5,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.content).toBe('new content');
        expect(data.tags).toBe('new-tag');
        expect(data.importance).toBe(5);
        expect(data.category).toBe('fact');
        expect(data.observation_ids).toBe('1');
    });

    it('PUT /api/memories/:id returns 404 for missing memory', async () => {
        const app = makeApp();
        const res = await req(app, 'PUT', '/api/memories/99999', { content: 'x' });
        expect(res.status).toBe(404);
    });

    it('PUT /api/memories/:id returns 400 for invalid category', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('test-proj');
        const memId = insertMemory(proj.id, 'content', '', 'fact', 3, '');
        const res = await req(app, 'PUT', `/api/memories/${memId}`, { category: 'nonexistent' });
        expect(res.status).toBe(400);
    });
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run test/api.test.ts`
Expected: All tests pass including the 6 new ones

- [ ] **Step 4: Commit**

```bash
git add test/api.test.ts
git commit -m "test: add GET and PUT memory endpoint tests"
```

---


### Task 4: Frontend — Update Memory type and add expand button to MemoryCard

**Files:**
- Modify: `src/ui/App.tsx:15-26` (Memory type)
- Modify: `src/ui/components/MemoryCard.tsx:7-11` (props), `~40-45` (add button)

- [ ] **Step 1: Add `observation_ids` to Memory type in App.tsx**

In `src/ui/App.tsx`, update the `Memory` type:

```typescript
export type Memory = {
    id: number;
    content: string;
    tags: string;
    category: string;
    importance: number;
    domain: string | null;
    reason: string;
    observation_ids: string;
    created_at: string;
    updated_at: string;
    project_path: string;
};
```

- [ ] **Step 2: Add expand button to MemoryCard**

In `src/ui/components/MemoryCard.tsx`, add an `onExpand` prop:

```typescript
export const MemoryCard: Component<{
    memory: Memory;
    onDelete: (id: number) => void;
    onExpand: (memory: Memory) => void;
    animation?: string;
    widthClass?: string;
    domainIcon?: string;
    categoryIcon?: string;
}> = (props) => {
```

Add the expand button next to the existing delete button (inside the `div.flex.items-center.gap-2.shrink-0`), before the delete button:

```tsx
                    <button
                        onClick={() => props.onExpand(m)}
                        class="text-neutral-500 hover:text-[#d77757] text-xs px-1.5 py-0.5 rounded hover:bg-[#d77757]/10"
                        title="View details"
                    >
                        <Icon name="expand" size={12} />
                    </button>
```

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `pnpm build`
Expected: Build fails because existing MemoryCard call sites don't pass `onExpand` yet. That's expected — will be wired in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/ui/App.tsx src/ui/components/MemoryCard.tsx
git commit -m "feat: add observation_ids to Memory type and expand button to MemoryCard"
```

---


### Task 5: Frontend — Create MemoryDetailModal component

**Files:**
- Create: `src/ui/components/MemoryDetailModal.tsx`

- [ ] **Step 1: Create the MemoryDetailModal component**

Create `src/ui/components/MemoryDetailModal.tsx`. This is the largest piece — the full component with:

- Two-column layout (content+tags left, sidebar right, footer)
- Contenteditable divs for content and tags
- Dropdown pickers for category and domain (with Escape stopPropagation)
- Clickable star rating for importance
- Dirty tracking per field with red dot indicators
- Tags normalization (trim whitespace, strip empty)
- Update button disabled until dirty
- Cancel reverts to original values

Key implementation details:

```typescript
import { type Component, createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { type Memory } from '../App';
import Overlay from './Overlay';
import Icon from './Icon';

type TaxonomyItem = { name: string; description: string; icon: string; count: number };

// Tags normalization helper
const normalizeTags = (raw: string): string =>
    raw.split(',').map(t => t.trim()).filter(Boolean).join(',');
```

**Dirty tracking pattern:** Store original values in signals on `createEffect` when `props.memory` changes. Compare current signal values against originals. A computed `isDirty` memo drives the Update button.

**Dropdown pattern:** Each dropdown (category, domain) is a local component with its own `open` signal. On Escape keydown inside the dropdown, call `e.stopPropagation()` and close the dropdown — prevents Overlay from closing the modal.

**Star rating pattern:** `<For each={[1,2,3,4,5]}>` with click handlers that call `setImportance(n)`.

**Content contenteditable:** Use `onInput` to sync text from the contenteditable div to a signal. Use `textContent` (not `innerHTML`) to get plain text.

**Tags contenteditable:** Same pattern but show pills when not focused, plain text when focused. Use a `tagsFocused` signal to toggle between pill display and text input.

The full component structure:

```
<Overlay>
  <div.bg-neutral-900.border.rounded-xl.shadow-2xl.w-[640px].max-h-[85vh].flex.flex-col>
    <div.flex>  <!-- two columns -->
      <div.flex-1.p-5>  <!-- left: content + tags -->
        <div contenteditable>  <!-- content -->
        <div>  <!-- tags label + contenteditable/pills -->
      </div>
      <div.w-[185px].border-l.p-4>  <!-- right: sidebar -->
        Category dropdown
        Domain dropdown
        Stars
        Reason (read-only)
        Timestamps (read-only)
      </div>
    </div>
    <div.border-t.px-5.py-2.5>  <!-- footer -->
      <span>#id · project · obs: ids</span>
      <Cancel> <Update disabled={!isDirty()}>
    </div>
  </div>
</Overlay>
```

- [ ] **Step 2: Build to verify no TypeScript errors in the component**

Run: `pnpm build`
Expected: May still fail because App.tsx doesn't import/use it yet. Component itself should have no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/MemoryDetailModal.tsx
git commit -m "feat: create MemoryDetailModal component with dirty tracking"
```

---


### Task 6: Frontend — Wire modal into App.tsx with URL routing

**Files:**
- Modify: `src/ui/App.tsx:69` (MODAL_PARAMS)
- Modify: `src/ui/App.tsx` (signals, syncFromUrl, open/close, render)

- [ ] **Step 1: Add `'memory'` to MODAL_PARAMS**

```typescript
const MODAL_PARAMS = ['settings', 'merge', 'help', 'logs', 'memory'] as const;
```

- [ ] **Step 2: Add memory detail signals and handlers**

After the existing modal signals (~line 86):

```typescript
    const [memoryDetailOpen, setMemoryDetailOpen] = createSignal(false);
    const [memoryDetail, setMemoryDetail] = createSignal<Memory | null>(null);
    const [taxonomyDomains, setTaxonomyDomains] = createSignal<any[]>([]);
    const [taxonomyCategories, setTaxonomyCategories] = createSignal<any[]>([]);
```

Add open/close handlers after the existing modal handlers:

```typescript
    const openMemoryDetail = async (memOrId: Memory | number) => {
        let mem: Memory;
        if (typeof memOrId === 'number') {
            try {
                const res = await fetch(`/api/memories/${memOrId}`);
                if (!res.ok) { showToast('Memory not found'); return; }
                mem = await res.json();
            } catch { showToast('Failed to load memory'); return; }
        } else {
            mem = memOrId;
        }
        // Fetch taxonomy for dropdowns
        try {
            const [d, c] = await Promise.all([
                fetch('/api/domains').then(r => r.json()),
                fetch('/api/categories').then(r => r.json()),
            ]);
            setTaxonomyDomains(d);
            setTaxonomyCategories(c);
        } catch { /* dropdowns will be empty */ }
        setMemoryDetail(mem);
        setMemoryDetailOpen(true);
        openModalUrl({ memory: String(mem.id) });
    };

    const closeMemoryDetail = () => {
        setMemoryDetailOpen(false);
        setMemoryDetail(null);
        closeModalUrl();
    };

    const handleMemoryUpdate = async (id: number, fields: {
        content: string; tags: string; category: string; importance: number; domain: string | null;
    }) => {
        const res = await fetch(`/api/memories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Update failed');
        }
        showToast('Memory updated');
        refresh();
    };
```

- [ ] **Step 3: Update `syncFromUrl()` to handle `?memory=<id>`**

In the existing `syncFromUrl()` function, add after the `help` branch:

```typescript
        if (params.has('memory')) {
            const memId = parseInt(params.get('memory')!, 10);
            if (!isNaN(memId) && !memoryDetailOpen()) {
                openMemoryDetail(memId);
            }
        } else {
            setMemoryDetailOpen(false);
            setMemoryDetail(null);
        }
```

- [ ] **Step 4: Pass `onExpand` to all MemoryCard instances**

Find all `<MemoryCard` usages in App.tsx and add the `onExpand` prop:

```tsx
<MemoryCard
    memory={mem}
    onDelete={(id) => setDeleteTarget({ type: 'memory', id })}
    onExpand={(m) => openMemoryDetail(m)}
    // ... other existing props
/>
```

- [ ] **Step 5: Render the MemoryDetailModal**

Import the component and add it near the other modals (before the toast):

```tsx
import MemoryDetailModal from './components/MemoryDetailModal';
```

```tsx
            <MemoryDetailModal
                memory={memoryDetail()}
                domains={taxonomyDomains()}
                categories={taxonomyCategories()}
                open={memoryDetailOpen()}
                onClose={closeMemoryDetail}
                onUpdate={handleMemoryUpdate}
                showToast={showToast}
            />
```

- [ ] **Step 6: Build and verify**

Run: `pnpm build`
Expected: Clean build, no TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire MemoryDetailModal with URL routing in App.tsx"
```

---


### Task 7: Build, test, and deploy

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run test/`
Expected: All tests pass (100 existing + 6 new = 106)

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: Clean build

- [ ] **Step 3: Deploy to plugin cache**

```bash
cp -r dist/* ~/.claude/plugins/cache/damusix-ai-tools/ai-memory/1.1.1/dist/
curl -s -X POST http://localhost:24636/api/restart
```

- [ ] **Step 4: Manual verification**

Open http://localhost:24636 and verify:
- Hover a memory card → expand icon appears
- Click expand → modal opens with full content
- Edit content → red dot appears, Update button enables
- Change category/domain via dropdown → red dot appears
- Click stars → importance changes with red dot
- Click Update → memory saved, modal closes, card reflects changes
- Navigate to `?memory=<id>` directly → modal opens
- Browser back → modal closes
