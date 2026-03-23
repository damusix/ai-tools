# Architecture Snapshot Dashboard UI


## Problem

The architecture snapshot feature scans projects and generates summaries, but the results are invisible to users. There's no way to see what was detected, verify correctness, or trigger a rescan from the dashboard.


## Goals

1. Display architecture snapshot data per project in the dashboard, following the existing Summary section pattern.
2. Show detected framework/stack signals as visual badges for quick identification.
3. Provide a detail modal with the full LLM analysis and raw JSON facts.
4. Allow users to trigger a rescan (regenerate) from the UI, matching the Summary regenerate UX.


## Non-goals

- Editing architecture data from the UI (read-only display).
- Showing architecture diff history (v1 stores only latest snapshot).
- Displaying architecture in the `_global` pseudo-project.


## Data flow


### Backend changes

**`listProjects()` in `src/db.ts`:** Add `architecture_summary`, `architecture_facts`, `architecture_full`, `architecture_scanned_at` to the SELECT query. These columns already exist on the `projects` table.

**No new API endpoints needed.** The existing `POST /api/projects/:id/architecture` triggers a rescan. The existing `GET /api/projects` (which calls `listProjects()`) will now return architecture data inline.

**Refresh after rescan:** The `triggerArchitectureScan` handler must call `refresh()` explicitly on success, matching the `triggerSummary` pattern. Do NOT rely on SSE for this — the architecture POST endpoint returns synchronously and the worker broadcast may or may not have fired by then.


### Frontend changes

**`Project` type in `App.tsx`:** Add fields matching the new columns:

```typescript
architecture_summary: string;
architecture_facts: string;   // JSON string, parsed on demand
architecture_full: string;
architecture_scanned_at: string;
```

All four columns have `TEXT NOT NULL DEFAULT ''` in the DB, so the type is `string` (never `undefined`). Empty string `''` is the sentinel for "not scanned yet."


## UI components


### Architecture section (inline, collapsible)

Lives directly below the AI Summary section, inside the same project group container. Same visual weight and interaction pattern.

**When no architecture data exists** (`architecture_scanned_at` is empty string):

- A single button: "Scan Project Architecture" with a sitemap icon.
- Clicking triggers `POST /api/projects/:id/architecture`.
- Spinner while in progress.
- **On error** (non-ok response): show toast with error message, leave UI in previous state (same as Summary error handling).

**When architecture data exists:**

- **Header row:** Sitemap icon + "Architecture" label + collapse/expand chevron + regenerate button + expand (modal) button.
- **Collapsed state:** Just the header row (persisted via `localStorage` key `ai-memory:collapsed-architecture`).
- **Expanded state:** Header row + summary text + signal badges.
- **Summary text:** `architecture_summary` rendered as `whitespace-pre-wrap` in a styled container. Use cyan/teal accent (`border-cyan-500/10`, `text-cyan-500/80`) to differentiate from Summary's amber.
- **Signal badges:** Parse `architecture_facts` JSON, extract `signals[].kind`. Render as small pill badges (e.g., `bg-cyan-500/10 text-cyan-400/80 text-[10px] px-1.5 py-0.5 rounded`). Displayed in a `flex flex-wrap gap-1` row below the summary text.

**Regenerate button:** Same pattern as Summary — small icon button with `fa-arrows-rotate`, disabled + spinner while regenerating. Calls `POST /api/projects/:id/architecture`.

**Expand button:** Small icon button with `fa-expand` or `fa-up-right-and-down-left-from-center`. Opens the detail modal.


### Architecture detail modal

A read-only modal using the existing `Overlay` component. Width `max-w-3xl` (wider than MemoryDetailModal since it shows formatted text and JSON).

**Layout:** Three-tab navigation at top:

| Tab | Content |
|-----|---------|
| Summary | `architecture_summary` — the token-capped prose |
| Full Analysis | `architecture_full` — detailed Haiku interpretation. If empty, show "No full analysis available — trigger a rescan." |
| Raw Facts | Pretty-printed JSON of parsed `architecture_facts` |

**Tab styling:** Simple underline tabs matching the dark theme. Active tab gets cyan accent underline + brighter text.

**Footer:** Metadata line showing `Scanned: <architecture_scanned_at formatted>`. Close button.

**Raw Facts tab:** Render inside a `<pre>` block with `text-xs font-mono overflow-auto max-h-[60vh]`. Use `JSON.stringify(parsed, null, 2)`.


## State management

New signals in `App.tsx` (following existing patterns):

- `collapsedArchitecture` — `Record<string, boolean>`, localStorage key `ai-memory:collapsed-architecture`, toggle function `toggleArchitecture(path)`. Follow the exact same init/persistence pattern as `collapsedSummaries`.
- `generatingArchitecture` — `Record<string, boolean>`, tracks in-flight rescan requests.
- `architectureModalProject` — `string | null`, the project path whose architecture detail modal is open.

Helper memo:

- `projectArchitectureMap()` — `Record<string, { summary, facts, full, scannedAt }>` derived from `projects()`. Only include entries where `scannedAt` is non-empty. The `<Show when={projectArchitectureMap()[path]}>` gate determines empty vs. populated state — if `scannedAt` is `''`, the entry is absent from the map, showing the "Scan" button fallback.


## File changes

| File | Change |
|------|--------|
| `src/db.ts` | Add 4 columns to `listProjects()` SELECT |
| `src/ui/App.tsx` | Add `Project` type fields, state signals, `triggerArchitectureScan` handler, architecture section JSX (below summary), modal open/close logic |
| `src/ui/components/ArchitectureModal.tsx` | New component: tabbed read-only modal |


## Testing

- Manual: verify section appears below Summary, collapsible, signals render, modal opens with tabs, regenerate triggers scan.
- Existing architecture tests (`test/architecture-scan.test.ts`, `test/context-architecture.test.ts`) remain unchanged — this is UI-only.
