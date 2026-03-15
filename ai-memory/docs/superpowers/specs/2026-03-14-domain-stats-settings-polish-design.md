# Spec: Per-Domain Stats & Settings Delete UX


## Goal

Two independent UI improvements for the ai-memory dashboard:

1. **Per-domain stats** — Show memory counts on domain headers, matching the existing category count pattern
2. **Delete UX refinement** — Skip confirmation for zero-count taxonomy deletes


## Feature 1: Per-Domain Stats in UI


### Current State

- Category headers already show inline counts: `category (12)` via `catGroup.memories.length` at `src/ui/App.tsx:618`
- Domain headers at `src/ui/App.tsx:593-602` show the domain name and icon but no count
- `listDomains()` in `src/db.ts` returns a `count` field per domain, but the UI computes counts from the `groupedMemories` memo instead


### Design

Add `(totalCount)` inline to domain headers using the same pattern as category headers.

**Count source:** Sum of `catGroup.memories.length` across all categories in the domain group. This keeps it consistent with how category counts are derived (from the in-memory grouped data, not a separate API call).

**Rendering:** Inside the domain header button, after the domain name span, add:

```tsx
<span class="text-neutral-600 font-normal">
    ({domGroup.categories.reduce((sum, c) => sum + c.memories.length, 0)})
</span>
```

### Files to Modify

| File | Change |
|------|--------|
| `src/ui/App.tsx` ~line 597 | Add count span to domain header button |


## Feature 2: Delete UX Refinement


### Current State

The `TaxonomySection` component in `Settings.tsx` (lines 263-429) has a delete flow where `handleDelete(item)` always sets `deleteTarget`, which opens a `ConfirmModal` — even for items with 0 associated memories.

The `confirmDelete()` function (line 311-336) reads from the `deleteTarget()` signal to get the item to delete.


### Design

Skip the confirmation modal for items with 0 references. Only show the modal for items that have associated memories (count > 0).

**Implementation:** In `handleDelete()`, when `item.count === 0`, inline the delete API call directly (fetch DELETE to `/api/{domains|categories}/{name}`) instead of setting `deleteTarget`. This avoids the dependency on the `deleteTarget()` signal that `confirmDelete()` reads from.

For items with `count > 0`, the existing flow is unchanged: set `deleteTarget`, show the `ConfirmModal` with force-delete option.


### Files to Modify

| File | Change |
|------|--------|
| `src/ui/components/Settings.tsx` | Modify `handleDelete()` to inline delete for zero-count items |


## Already Implemented (removed from scope)

The following features from the handoff doc are already present in the codebase:

- **Help text** for Domains/Categories tabs — exists at `Settings.tsx:777-779` and `Settings.tsx:814-816`
- **Restore defaults** — `restoreDefaultDomains()`/`restoreDefaultCategories()` in `db.ts:659-679`, POST endpoints in `app.ts:199-204,252-257`, UI wiring in `Settings.tsx` with `ConfirmModal` (additive `INSERT OR IGNORE` approach)
- **limit=0 unlimited results** — conditional LIMIT clause already in `db.ts` query functions


## Out of Scope

- URL-based routing (Feature 2 from handoff)
- Plugin installation fix (Feature 5 from handoff)
- Changing restore-defaults from additive to destructive behavior
