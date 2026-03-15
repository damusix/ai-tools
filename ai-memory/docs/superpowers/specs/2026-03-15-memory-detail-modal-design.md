# Memory Detail Modal — Design Spec


## Overview

Add a detail modal that opens when clicking an expand button on a MemoryCard. The modal provides a full view of all memory fields with in-place editing via contenteditable elements, dirty tracking with red dot indicators, and a disabled-until-dirty Update button.


## Trigger

A hover-reveal expand icon button on each MemoryCard (matching the existing delete X pattern — `opacity-0 group-hover:opacity-100`). Clicking it opens the modal. URL syncs via `?memory=<id>`.


## Layout

Two-column modal (~640px wide) using the existing Overlay component:

**Left column (flex-1):**
- Content — contenteditable div with dashed border, full text visible (no truncation)
- Tags — contenteditable div below content, comma-separated text rendered as pills in view mode

**Right sidebar (~185px, border-left):**
- Category — clickable pill that opens a dropdown of existing categories from `/api/categories`
- Domain — clickable pill that opens a dropdown of existing domains from `/api/domains`
- Importance — clickable 1-5 stars
- Reason — read-only italic text (LLM provenance, not user-editable)
- Created/Updated timestamps — read-only

**Footer bar (border-top):**
- Left: `#id · project_path` and `obs: 1, 2, 3` (observation IDs, from `observation_ids` field)
- Right: Cancel button + Update button (disabled until dirty)


## Data Model Changes

The frontend `Memory` type in `App.tsx` must add `observation_ids: string` to match the DB column. The `listMemories()` query in `db.ts` must include `observation_ids` in its SELECT.

A new `GET /api/memories/:id` endpoint is needed for deep-link restore (when navigating directly to `?memory=42`). Returns the full memory row including `observation_ids`.


## Editing UX

Fields are always in-place editable — no mode toggle.

**Contenteditable fields (content, tags):**
- Dashed border visible on hover/focus to indicate editability
- Content: free text, preserves line breaks
- Tags: comma-separated string; displayed as pills, editable as plain text on focus
- Tags normalization: trim whitespace around each tag and strip empty entries before dirty comparison and before sending to API (e.g. `"react, hooks , "` → `"react,hooks"`)

**Dropdown fields (category, domain):**
- Click the pill to open a dropdown of existing values fetched from API
- Dropdown uses existing taxonomy data (no new endpoints needed beyond what exists)
- Dropdown must call `stopPropagation()` on Escape key to prevent Overlay from closing the entire modal when dismissing the dropdown

**Clickable stars (importance):**
- Click a star to set importance 1-5
- Visual feedback: filled stars up to selected value

**Dirty tracking:**
- Each field stores its original value on modal open
- When a field's current value differs from original, a small red `fa-circle` icon (7px) appears at its top-right corner
- The Update button enables only when at least one field is dirty
- Cancel reverts all fields to original values and closes the modal


## Backend

**New endpoint: `GET /api/memories/:id`**

Returns a single memory by ID including `observation_ids`. Returns 404 if not found.

**New endpoint: `PUT /api/memories/:id`**

Uses the existing `updateMemory()` function in `src/db.ts`. Important: `updateMemory(id, content, tags, category, importance, observationIds, domain?, reason?)` requires all positional parameters — there is no partial-update path at the DB layer.

The endpoint:

1. Parses the memory ID from the URL (return 400 if NaN)
2. Accepts JSON body with fields: `content`, `tags`, `category`, `importance`, `domain`
3. Fetches the current memory to get all existing values (return 404 if not found)
4. Merges provided fields with existing values, preserving `observation_ids` and `reason` from the fetched memory
5. Calls `updateMemory()` with full merged values
6. Catches validation errors from `updateMemory()` (invalid category/domain) and returns 400
7. Broadcasts `memory:updated` via SSE
8. Returns the updated memory

No new database changes needed — `updateMemory()` already exists.


## URL Routing

Follows the existing URL routing pattern established for other modals:

- Add `'memory'` to the `MODAL_PARAMS` array in `App.tsx`
- Opening: `openModalUrl({ memory: String(id) })`
- Closing: `closeModalUrl()`
- `syncFromUrl()`: if `?memory=<id>` is present, parse the ID, fetch via `GET /api/memories/:id`, and open the modal. If fetch fails (404, invalid ID), silently clear the URL param and show a toast.
- Uses the same `pushState`/`replaceState` pattern as Settings, Transfer, Help, and Logs modals


## Files

| File | Change |
|------|--------|
| `src/ui/components/MemoryDetailModal.tsx` | **New** — the modal component with contenteditable fields, dirty tracking, dropdowns, star rating |
| `src/ui/components/MemoryCard.tsx` | Add hover-reveal expand button |
| `src/ui/App.tsx` | Add `'memory'` to `MODAL_PARAMS`, add `memoryDetail` signal, URL routing for `?memory=<id>`, fetch memory on open, add `observation_ids` to Memory type |
| `src/app.ts` | Add `GET /api/memories/:id` and `PUT /api/memories/:id` endpoints |
| `src/db.ts` | Add `observation_ids` to `listMemories()` SELECT, add `getMemoryById()` function |
| `test/api.test.ts` | Tests for GET and PUT endpoints (happy path, 404, invalid ID, invalid category/domain) |


## Component Interface

```typescript
type MemoryDetailModalProps = {
    memory: Memory | null;
    domains: TaxonomyItem[];
    categories: TaxonomyItem[];
    open: boolean;
    onClose: () => void;
    onUpdate: (id: number, fields: {
        content: string;
        tags: string;
        category: string;
        importance: number;
        domain: string | null;
    }) => Promise<void>;
    showToast: (msg: string) => void;
};
```

Where `TaxonomyItem` is the existing type `{ name: string; description: string; icon: string; count: number }` already used in Settings.tsx.

The parent (App.tsx) owns the memory data and update logic. The modal is a controlled component that receives taxonomy lists for the dropdowns. `onUpdate` receives the full merged field values (not a partial patch), and the parent calls the PUT endpoint.


## Out of Scope

- Observation detail view (clicking observation IDs)
- Memory creation from the modal
- Bulk editing multiple memories
- Keyboard shortcuts within the modal
