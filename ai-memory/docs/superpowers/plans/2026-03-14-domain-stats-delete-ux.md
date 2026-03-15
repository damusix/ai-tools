# Domain Stats & Delete UX Implementation Plan


> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline memory counts to domain headers and skip delete confirmation for zero-count taxonomy items.

**Architecture:** Two independent UI-only changes in the SolidJS dashboard. No backend modifications needed.

**Tech Stack:** SolidJS, Tailwind CSS, Vite

**Spec:** `docs/superpowers/specs/2026-03-14-domain-stats-settings-polish-design.md`

---


## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/ui/App.tsx` | Modify ~line 599 | Add domain count span |
| `src/ui/components/Settings.tsx` | Modify ~lines 307-309 | Skip confirmation for zero-count deletes |


---


## Task 1: Add Domain Memory Count Display

**Files:**
- Modify: `src/ui/App.tsx:597-600`

- [ ] **Step 1: Add count span to domain header**

In `src/ui/App.tsx`, inside the domain header button, the domain name is rendered at line 599. Add a count span after it, matching the category pattern at line 618:

```tsx
// Current (line 597-600):
<span class="capitalize flex items-center gap-1.5">
    <i class={`fa-solid ${domainIconMap()[domGroup.domain] || 'fa-folder'}`} style="font-size: 14px"></i>
    {domGroup.domain}
</span>

// Change to:
<span class="capitalize flex items-center gap-1.5">
    <i class={`fa-solid ${domainIconMap()[domGroup.domain] || 'fa-folder'}`} style="font-size: 14px"></i>
    {domGroup.domain}
    <span class="text-neutral-600 font-normal text-xs">({domGroup.categories.reduce((sum, c) => sum + c.memories.length, 0)})</span>
</span>
```

- [ ] **Step 2: Verify in browser**

Run: `pnpm dev:ui`

Open the dashboard. Verify:
- Each domain header shows `(N)` after the domain name
- The count matches the sum of all category counts within that domain
- Styling is muted (`text-neutral-600`) and not bold (`font-normal`), matching category counts

- [ ] **Step 3: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ui): show memory count on domain headers"
```


---


## Task 2: Skip Delete Confirmation for Zero-Count Taxonomy Items

**Files:**
- Modify: `src/ui/components/Settings.tsx:307-309`

- [ ] **Step 1: Modify handleDelete to inline zero-count deletes**

In `src/ui/components/Settings.tsx`, replace the `handleDelete` function (lines 307-309):

```tsx
// Current:
const handleDelete = (item: TaxonomyItem) => {
    setDeleteTarget(item);
};

// Change to:
const handleDelete = async (item: TaxonomyItem) => {
    if (item.count > 0) {
        setDeleteTarget(item);
        return;
    }
    const endpoint = props.type === 'domain'
        ? `/api/domains/${encodeURIComponent(item.name)}`
        : `/api/categories/${encodeURIComponent(item.name)}`;
    try {
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (res.ok) {
            props.showToast(`${props.type} "${item.name}" deleted`);
            props.onRefresh();
        } else {
            const err = await res.json();
            props.showToast(err.error || 'Delete failed');
        }
    } catch {
        props.showToast('Delete failed');
    }
};
```

This inlines the delete API call for zero-count items, bypassing `setDeleteTarget` and the `ConfirmModal` entirely. Items with `count > 0` still go through the existing confirmation flow.

- [ ] **Step 2: Verify in browser**

Run: `pnpm dev:ui`

Open Settings > Domains or Categories tab. Test:
- Deleting an item with 0 memories: should delete immediately with a toast, no modal
- Deleting an item with memories: should show the existing `ConfirmModal` with force-delete option
- Error case: if the API returns an error, toast should show the error message

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/Settings.tsx
git commit -m "feat(ui): skip delete confirmation for zero-count taxonomy items"
```
