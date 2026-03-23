# Architecture Dashboard UI — Implementation Plan


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display architecture snapshot data (summary, signals, full analysis, raw facts) per project in the dashboard, with collapsible section, regenerate button, and detail modal.

**Architecture:** Add 4 architecture columns to the `listProjects()` SQL query so the existing projects resource carries the data. Add state signals + handler in `App.tsx` following the Summary section pattern. Create a new `ArchitectureModal.tsx` component for the tabbed detail view.

**Tech Stack:** SolidJS, Tailwind CSS 4, existing `Overlay` component, FontAwesome icons.

**Spec:** `docs/superpowers/specs/2026-03-21-architecture-dashboard-ui-design.md`

---

## File map


| Area     | File                                         | Change |
| -------- | -------------------------------------------- | ------ |
| Backend  | `src/db.ts`                                  | Modify: add 4 columns to `listProjects()` SELECT |
| Types    | `src/ui/App.tsx`                              | Modify: extend `Project` type with 4 fields |
| State    | `src/ui/App.tsx`                              | Modify: add architecture signals, memo, handler |
| UI       | `src/ui/App.tsx`                              | Modify: add architecture section JSX below summary |
| Modal    | `src/ui/components/ArchitectureModal.tsx`     | Create: tabbed read-only detail modal |

---

### Task 1: Add architecture columns to `listProjects()` query

**Files:**

- Modify: `src/db.ts:364-380`

- [ ] **Step 1: Update the SELECT query**

In `src/db.ts`, function `listProjects()`, change the SELECT from:

```sql
SELECT p.id, p.path, p.name, p.icon, p.description, p.created_at, p.summary,
```

to:

```sql
SELECT p.id, p.path, p.name, p.icon, p.description, p.created_at, p.summary,
    p.architecture_summary, p.architecture_facts, p.architecture_full, p.architecture_scanned_at,
```

- [ ] **Step 2: Verify build**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat(ai-memory): include architecture columns in listProjects query"
```

---

### Task 2: Create ArchitectureModal component

**Files:**

- Create: `src/ui/components/ArchitectureModal.tsx`

- [ ] **Step 1: Write the component**

Create `src/ui/components/ArchitectureModal.tsx`:

```tsx
import { type Component, createSignal, For, Show } from 'solid-js';
import Overlay from './Overlay';

type ArchitectureData = {
    summary: string;
    full: string;
    facts: string;
    scannedAt: string;
};

const TABS = ['Summary', 'Full Analysis', 'Raw Facts'] as const;
type Tab = (typeof TABS)[number];

const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : '');

const ArchitectureModal: Component<{
    data: ArchitectureData | null;
    open: boolean;
    onClose: () => void;
}> = (props) => {
    const [tab, setTab] = createSignal<Tab>('Summary');

    const parsedFacts = () => {
        if (!props.data?.facts) return null;
        try {
            return JSON.parse(props.data.facts);
        } catch {
            return null;
        }
    };

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <Show when={props.data}>
                {(data) => (
                    <div
                        class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Tab bar */}
                        <div class="flex border-b border-neutral-700">
                            <For each={[...TABS]}>
                                {(t) => (
                                    <button
                                        class={`px-4 py-2.5 text-xs font-medium transition-colors ${
                                            tab() === t
                                                ? 'text-cyan-400 border-b-2 border-cyan-400'
                                                : 'text-neutral-500 hover:text-neutral-300'
                                        }`}
                                        onClick={() => setTab(t)}
                                    >
                                        {t}
                                    </button>
                                )}
                            </For>
                        </div>

                        {/* Tab content */}
                        <div class="flex-1 overflow-y-auto p-5">
                            <Show when={tab() === 'Summary'}>
                                <Show
                                    when={data().summary}
                                    fallback={
                                        <p class="text-xs text-neutral-500 italic">
                                            No summary available — trigger a rescan.
                                        </p>
                                    }
                                >
                                    <div class="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap">
                                        {data().summary}
                                    </div>
                                </Show>
                            </Show>

                            <Show when={tab() === 'Full Analysis'}>
                                <Show
                                    when={data().full}
                                    fallback={
                                        <p class="text-xs text-neutral-500 italic">
                                            No full analysis available — trigger a rescan.
                                        </p>
                                    }
                                >
                                    <div class="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap">
                                        {data().full}
                                    </div>
                                </Show>
                            </Show>

                            <Show when={tab() === 'Raw Facts'}>
                                <Show
                                    when={parsedFacts()}
                                    fallback={
                                        <p class="text-xs text-neutral-500 italic">
                                            No facts available — trigger a rescan.
                                        </p>
                                    }
                                >
                                    <pre class="text-xs font-mono text-neutral-400 overflow-auto max-h-[60vh] bg-neutral-950 rounded-lg p-3 border border-neutral-800">
                                        {JSON.stringify(parsedFacts(), null, 2)}
                                    </pre>
                                </Show>
                            </Show>
                        </div>

                        {/* Footer */}
                        <div class="border-t border-neutral-700 px-5 py-2.5 flex items-center justify-between">
                            <div class="text-[10px] text-neutral-600">
                                Scanned: {fmtDate(data().scannedAt)}
                            </div>
                            <button
                                onClick={props.onClose}
                                class="text-xs px-3 py-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </Show>
        </Overlay>
    );
};

export default ArchitectureModal;
```

- [ ] **Step 2: Verify build**

Run: `cd ai-memory && pnpm build`
Expected: PASS (component not imported yet, but should compile if types are correct)

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/ArchitectureModal.tsx
git commit -m "feat(ai-memory): add ArchitectureModal component with tabbed detail view"
```

---

### Task 3: Add architecture state, handler, and section to App.tsx

This is the main integration task. All changes are in `src/ui/App.tsx`.

**Files:**

- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Add import**

At the top of `App.tsx`, after the `MemoryDetailModal` import (line 13), add:

```typescript
import ArchitectureModal from './components/ArchitectureModal';
```

- [ ] **Step 2: Extend the `Project` type**

Add 4 fields to the `Project` type (after `summary: string;` on line 45):

```typescript
architecture_summary: string;
architecture_facts: string;
architecture_full: string;
architecture_scanned_at: string;
```

- [ ] **Step 3: Add localStorage key constant**

After the existing `COLLAPSED_SUMMARIES_KEY` line (line 67), add:

```typescript
const COLLAPSED_ARCHITECTURE_KEY = 'ai-memory:collapsed-architecture';
```

- [ ] **Step 4: Add architecture state signals**

After the `triggerSummary` handler (after line 478), add:

```typescript
// ── Architecture state ──
const projectArchitectureMap = createMemo(() => {
    const map: Record<string, { summary: string; facts: string; full: string; scannedAt: string }> = {};
    for (const p of projects() || []) {
        if (p.architecture_scanned_at) {
            map[p.path] = {
                summary: p.architecture_summary,
                facts: p.architecture_facts,
                full: p.architecture_full,
                scannedAt: p.architecture_scanned_at,
            };
        }
    }
    return map;
});

const [collapsedArchitecture, setCollapsedArchitecture] = createSignal<Record<string, boolean>>(
    JSON.parse(localStorage.getItem(COLLAPSED_ARCHITECTURE_KEY) || '{}')
);
const toggleArchitecture = (key: string) => {
    setCollapsedArchitecture(prev => ({ ...prev, [key]: !prev[key] }));
};

const [generatingArchitecture, setGeneratingArchitecture] = createSignal<Record<string, boolean>>({});
const triggerArchitectureScan = async (projectPath: string) => {
    const proj = (projects() || []).find((p: Project) => p.path === projectPath);
    if (!proj) return;
    setGeneratingArchitecture(prev => ({ ...prev, [projectPath]: true }));
    try {
        const res = await fetch(`/api/projects/${proj.id}/architecture`, { method: 'POST' });
        if (res.ok) {
            showToast('Architecture scan complete');
            refresh();
        } else {
            showToast('Architecture scan failed');
        }
    } catch {
        showToast('Architecture scan failed');
    }
    setGeneratingArchitecture(prev => ({ ...prev, [projectPath]: false }));
};

const [architectureModalPath, setArchitectureModalPath] = createSignal<string | null>(null);
```

- [ ] **Step 5: Add localStorage persistence**

After the existing `createEffect` for `COLLAPSED_SUMMARIES_KEY` (line 283), add:

```typescript
createEffect(() => localStorage.setItem(COLLAPSED_ARCHITECTURE_KEY, JSON.stringify(collapsedArchitecture())));
```

- [ ] **Step 6: Add the architecture section JSX**

Find the closing of the summary section — it's the `})()}` on line 878. Immediately after it, add the architecture section. It follows the exact same IIFE pattern as the summary section:

```tsx
{/* Architecture section */}
{(() => {
    const archPath = projGroup.project === '_' ? project() : projGroup.project;
    if (!archPath || archPath === '_global') return null;
    if (projGroup.project !== '_' && collapsedProjects()[projGroup.project]) return null;
    const archData = projectArchitectureMap()[archPath];
    const signals = (() => {
        if (!archData?.facts) return [];
        try {
            const parsed = JSON.parse(archData.facts);
            return (parsed.signals || []).map((s: any) => s.kind);
        } catch {
            return [];
        }
    })();
    return (
        <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} px-4 py-2`}>
            <Show when={archData} fallback={
                <button
                    class="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-cyan-400 transition-colors disabled:opacity-40"
                    onClick={() => triggerArchitectureScan(archPath)}
                    disabled={generatingArchitecture()[archPath]}
                >
                    <i class={`fa-solid ${generatingArchitecture()[archPath] ? 'fa-spinner fa-spin' : 'fa-sitemap'}`} style="font-size: 10px"></i>
                    <span>{generatingArchitecture()[archPath] ? 'Scanning architecture...' : 'Scan Project Architecture'}</span>
                </button>
            }>
                <div class="flex items-center gap-1.5">
                    <button
                        class="flex items-center gap-1.5 text-xs text-cyan-500/80 hover:text-cyan-400 transition-colors flex-1"
                        onClick={() => toggleArchitecture(archPath)}
                    >
                        <i class="fa-solid fa-sitemap" style="font-size: 10px"></i>
                        <span class="font-medium">Architecture</span>
                        <Icon name={collapsedArchitecture()[archPath] ? 'chevron-right' : 'chevron-down'} size={10} class="text-cyan-500/60" />
                    </button>
                    <button
                        class="p-1 rounded text-neutral-600 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40"
                        onClick={() => triggerArchitectureScan(archPath)}
                        disabled={generatingArchitecture()[archPath]}
                        title="Rescan architecture"
                    >
                        <i class={`fa-solid ${generatingArchitecture()[archPath] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} style="font-size: 10px"></i>
                    </button>
                    <button
                        class="p-1 rounded text-neutral-600 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
                        onClick={() => setArchitectureModalPath(archPath)}
                        title="View full architecture details"
                    >
                        <i class="fa-solid fa-up-right-and-down-left-from-center" style="font-size: 10px"></i>
                    </button>
                </div>
                <Show when={!collapsedArchitecture()[archPath]}>
                    <div class="mt-2 text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap bg-neutral-900/40 rounded-lg p-3 border border-cyan-500/10">
                        {archData!.summary}
                    </div>
                    <Show when={signals.length > 0}>
                        <div class="mt-2 flex flex-wrap gap-1">
                            <For each={signals}>
                                {(signal: string) => (
                                    <span class="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400/80">
                                        {signal}
                                    </span>
                                )}
                            </For>
                        </div>
                    </Show>
                </Show>
            </Show>
        </div>
    );
})()}
```

- [ ] **Step 7: Add the ArchitectureModal rendering**

Find the existing `MemoryDetailModal` JSX in the return (search for `<MemoryDetailModal`). Add the `ArchitectureModal` right after it:

```tsx
<ArchitectureModal
    data={(() => {
        const path = architectureModalPath();
        if (!path) return null;
        const arch = projectArchitectureMap()[path];
        if (!arch) return null;
        return arch;
    })()}
    open={!!architectureModalPath()}
    onClose={() => setArchitectureModalPath(null)}
/>
```

- [ ] **Step 8: Build and verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ai-memory): add architecture section and modal to dashboard"
```

---

### Task 4: Build, deploy, and verify

- [ ] **Step 1: Run full test suite**

Run: `cd ai-memory && pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Step 2: Build**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 3: Deploy to Claude cache**

```bash
CACHE_DIR=$(ls -d ~/.claude/plugins/cache/damusix-ai-tools/ai-memory/*/ | tail -1)
rsync -av --delete --exclude='node_modules' --exclude='tmp' --exclude='.mcp.json' \
    /Users/alonso/projects/claude-marketplace/ai-memory/ "$CACHE_DIR"
```

- [ ] **Step 4: Restart server**

```bash
cat ~/.ai-memory/ai-memory.pid | xargs kill 2>/dev/null
```

Server will restart automatically on next session. Open dashboard at `http://localhost:24636` to verify.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-21-architecture-dashboard-ui.md`.

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
