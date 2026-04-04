# Distillation UI Design


## Problem

The memory distillation backend (soft-delete, queue, worker processing) is implemented but has no user-facing surface. Users cannot see which memories were flagged for deletion, manually trigger distillation, restore false positives, or configure distillation settings through the dashboard.


## Solution

Add four UI surfaces to the existing ai-memory dashboard:

1. A **Deleted Memories** sidebar section below Observations
2. A **deleted mode** for MemoryDetailModal with restore/purge actions
3. **Distillation controls** alongside Consolidation in the project box
4. A **Distillation settings section** in the Settings modal


## API Endpoints

### New endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/memories/deleted` | GET | List soft-deleted memories. Query: `project?`, `limit?` (default 50). Returns memories where `deleted_at != ''`, ordered by `deleted_at DESC`. |
| `POST /api/projects/:id/distillation` | POST | Trigger distillation for a project. Enqueues a `distillation_queue` entry via `enqueueDistillation()`. Returns `{ queued: true }`. |
| `POST /api/memories/:id/restore` | POST | Restore a soft-deleted memory. Clears `deleted_at` and `deleted_reason`. Returns `{ restored: true }`. |

### New db function

`restoreMemory(id: number)` — sets `deleted_at = ''` and `deleted_reason = ''` on the memory row.

### Existing endpoint reuse

`DELETE /api/memories/:id` already hard-deletes by ID regardless of `deleted_at` status — used for "Permanently Delete".

### listProjects update

Include `distillation_at` and `distillation_memories_since` columns in the `listProjects()` query so the dashboard has distillation state per project.

### SSE event

New event `distillation:updated` broadcast when `processDistillationQueue()` completes in the worker, in addition to the existing `counts:updated` event. The dashboard listens for `distillation:updated` to refresh deleted memories list and distillation status.


## Deleted Memories Sidebar

### Location

Left sidebar column in `App.tsx`, below the Observations section.

### Visibility

Only renders when the count of deleted memories for the selected project is > 0.

### Structure

- **Header:** "Deleted Memories (N)" with trash icon (red/orange tint), same style as "Observations (5)" header. Info tooltip icon (same `ⓘ` icon used everywhere else) linking to help topic.
- **Cards:** Same column layout as observation cards. Each card shows:
  - Content preview (max-height with overflow, same as observation cards)
  - Delete reason in italic below content
  - Metadata footer: `#ID · project path · deleted date`
- **Click behavior:** Opens `MemoryDetailModal` in `deleted` mode.

### Data fetching

New SolidJS resource `deletedMemories` fetched from `GET /api/memories/deleted?project=...`. Refetched on `refreshKey()` signal and `distillation:updated` SSE event.


## MemoryDetailModal — Deleted Mode

### Prop change

Add `mode?: 'edit' | 'deleted'` prop (default `'edit'`).

### When `mode === 'deleted'`

**Left column:**

- Content rendered as **read-only** plain text (no `contentEditable`)
- Tags displayed as pills but **not editable** (no click-to-edit)

**Right sidebar:**

- Category, Domain, Importance displayed as **static text** (no Dropdown, no star buttons)
- Reason field shown as-is (existing, read-only)
- **New field:** "DELETE REASON" label below Reason, showing `deleted_reason` in italic, same style as Reason
- Timestamps: show Created, Updated, and **Deleted** (from `deleted_at`)

**Footer:**

- Left side: same metadata (`#ID · project path`)
- Right side buttons: **Cancel** | **Restore** | **Permanently Delete**
  - Cancel: closes modal
  - Restore (green accent): calls `POST /api/memories/:id/restore`, shows toast "Memory restored", closes modal, triggers refresh
  - Permanently Delete (red accent): shows confirm dialog ("This cannot be undone"), then calls `DELETE /api/memories/:id`, shows toast, closes modal, triggers refresh


## Distillation Controls

### Location

Same row as Consolidation in the Architecture section of the project box. Uses `justify-content: space-between` with `flex-wrap: wrap` so they sit side-by-side on wide screens and stack on narrow.

### Layout

```
Consolidation: ⓘ  Default  Always  Never          Distillation: ⓘ  [Run Now]  2 days ago · 3 flagged
```

### States

| State | Button | Status text |
|-------|--------|-------------|
| Never run | `Run Now` (enabled) | "Never run" |
| Running | `Run Now` (disabled, dimmed) | spinner + "Distilling memories..." (purple) |
| Completed | `Run Now` (enabled) | "Last run: {relative time} · {N} flagged" |

### Info tooltip

Same `ⓘ` icon as used throughout the dashboard. Tooltip text: "Distillation reviews your memories against the current codebase to find outdated or irrelevant entries. Flagged memories are hidden from searches and permanently deleted after the configured grace period."

### Button action

Calls `POST /api/projects/:id/distillation`. Loading state tracked via `distilling()` signal keyed by project path. SSE `distillation:updated` event clears loading state and refreshes.

### Data source

`distillation_at` and `distillation_memories_since` come from the `GET /api/projects` response (added to `listProjects()` query).


## Settings — Distillation Section

### Location

New section in the `sections` array in `Settings.tsx`, after the Projects section.

### Definition

```typescript
{
    icon: 'flask-vial', label: 'Distillation', fields: [
        { key: 'minAgeHours', label: 'Min Age (Hours)', fallback: 24, desc: 'hours between distillation runs' },
        { key: 'minMemoriesSince', label: 'Min Memories Since', fallback: 5, desc: 'new memories before distillation triggers' },
        { key: 'batchSize', label: 'Batch Size', fallback: 50, desc: 'memories per LLM call (per domain)' },
        { key: 'purgeAfterHours', label: 'Purge After (Hours)', fallback: 168, desc: 'hours before deleted memories are permanently removed' },
    ],
}
```

### Backend

No backend changes needed. `GET /api/config` and `PUT /api/config` already handle flat key-value config and unflatten to nested sections. The distillation keys flow through automatically since they're in the Zod schema.


## Files to Create or Modify

| File | Change |
|------|--------|
| `src/db.ts` | Add `restoreMemory()`, `listDeletedMemories()`, include distillation columns in `listProjects()` |
| `src/app.ts` | Add 3 new endpoints, add `distillation:updated` SSE listener |
| `src/distillation.ts` | Broadcast `distillation:updated` event on completion (add to existing `processDistillationQueue`) |
| `src/ui/App.tsx` | Deleted memories sidebar section, distillation controls row, SSE listener for `distillation:updated` |
| `src/ui/components/MemoryDetailModal.tsx` | Add `mode` prop, conditional rendering for deleted mode, restore/delete buttons |
| `src/ui/components/Settings.tsx` | Add Distillation section to `sections` array |
| `src/ui/help/deleted-memories.md` | New help topic for the info tooltip |


## Not in Scope

- Filtering deleted memories by domain or date range
- Bulk restore/delete actions
- Distillation history/log viewer
- Dashboard notification when distillation completes
