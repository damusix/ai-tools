# Handoff: UI & Feature Enhancements


## Goal

A set of independent UI and feature improvements: per-domain stats display, URL-based routing for modals, and shadcn-solid component library migration. These are separate from the search improvements (see `docs/handoff-search-improvements.md`).


## Related Design Docs

- Spec: `docs/superpowers/specs/2026-03-12-feature-enhancements-branding-design.md` (Tasks 1-2)
- Plan: `docs/superpowers/plans/2026-03-12-feature-enhancements-branding.md` (Tasks 1-2)
- `docs/plans/2026-03-03-dashboard-ux-v2.md`
- `docs/plans/2026-03-04-settings-ux-polish.md`
- `docs/plans/2026-03-05-fix-plugin-installation-design.md`


## Feature 1: Per-Domain Stats in UI

**Status:** Backend complete, UI not started.

### What exists

`listDomains()` at `src/db.ts:465-484` already returns a `count` field per domain:
```typescript
export function listDomains(projectPath?: string):
    { name: string; description: string; icon: string; count: number }[]
```

The SQL uses `COUNT(m.id) as count` with a `LEFT JOIN` to memories, grouped by domain name, ordered by count DESC.

### What's missing

The dashboard at `src/ui/App.tsx` does not display these counts. The domain headers in the memory panel need to show the count inline (e.g., `frontend (12)`).

Look at `src/ui/App.tsx` around line 485 where domains are rendered. The `MemoryGroup` type (lines 46-54) groups memories by domain — the count is available from the `listDomains()` response but isn't rendered in the DOM.

### Files to modify

| File | Change |
|------|--------|
| `src/ui/App.tsx` | Add count to domain header rendering |

This is frontend-only. No backend changes needed.


## Feature 2: URL-Based Routing

**Status:** NOT STARTED. No router dependency installed.

### What exists

Settings and Transfer modals are controlled by in-memory SolidJS signals:

`src/ui/App.tsx` — Uses `createSignal` for modal state:
```typescript
// 4 signal references to settingsOpen/transferOpen found in App.tsx
const [settingsOpen, setSettingsOpen] = createSignal(false);
const [transferOpen, setTransferOpen] = createSignal(false);
```

`src/ui/components/Settings.tsx:1` — Tab state is a local signal:
```typescript
const [tab, setTab] = createSignal<'config' | 'domains' | 'categories'>('config');
```

`src/ui/components/TransferModal.tsx` — Modal with no URL integration, opened/closed via signal.

### What's missing

No routing library in `package.json`. No URL query param sync. Browser back/forward doesn't work with modals.

### Two approaches

**Option A: Lightweight URL params (recommended for current scope)**
- Use `URLSearchParams` and `window.location.search` to sync modal state
- `?settings=config` opens Settings to config tab
- `?transfer=true` opens Transfer modal
- No new dependency needed

**Option B: Full SPA router**
- Install `@solidjs/router` (the official SolidJS router)
- Define routes: `/`, `/settings/:tab`, `/transfer`
- More infrastructure but enables future page-based navigation

### Files to modify

| File | Change |
|------|--------|
| `package.json` | Add router dep (Option B only) |
| `src/ui/App.tsx` | Sync modal signals with URL params |
| `src/ui/components/Settings.tsx` | Sync tab signal with URL params |
| `src/ui/components/TransferModal.tsx` | Sync open/close with URL params |


## Feature 3: shadcn-solid Migration

**Status:** NOT STARTED. Decision pending on scope.

### What exists

Current stack is pure SolidJS + Tailwind CSS with all custom components:
- `src/ui/components/Modal.tsx` — Custom modal/overlay
- `src/ui/components/Settings.tsx` — Custom tabs, forms, delete confirmations
- `src/ui/components/TransferModal.tsx` — Custom modal
- `src/ui/components/Taxonomy.tsx` — Custom taxonomy display
- `src/ui/components/Overlay.tsx` — Custom overlay
- `src/ui/components/Icon.tsx` — Icon wrapper
- `src/ui/components/HelpDrawer.tsx` — Custom slide-out drawer
- `src/ui/components/BrandLogo.tsx` — Logo component
- `src/ui/components/MemoryCard.tsx` — Memory display card
- `src/ui/App.tsx` — Main dashboard, all layout hand-coded

No component library (`shadcn-solid`, `@kobalte/core`, `@ark-ui/solid`) is installed.

### What's missing

This was identified as the highest-risk/scope work stream in the product roadmap. Key decision: full migration vs incremental adoption.

**Recommended incremental approach:**
1. Install `@kobalte/core` (the primitive library that shadcn-solid builds on)
2. Start with high-value components: Dialog/Modal, Tabs, Select/Dropdown
3. Migrate one component at a time, keeping existing styling
4. Use shadcn-solid's Tailwind-based theming to match current copper/amber branding

### Files to modify

| File | Change |
|------|--------|
| `package.json` | Add `@kobalte/core` or `shadcn-solid` |
| `src/ui/components/Modal.tsx` | Replace with Kobalte Dialog |
| `src/ui/components/Settings.tsx` | Replace tab logic with Kobalte Tabs |
| All components using dropdowns | Replace with Kobalte Select |


## Feature 4: limit=0 Unlimited Results

**Status:** NOT STARTED.

### What exists

All query functions unconditionally append `LIMIT ?`:

- `searchMemories()` at `src/db.ts:389` — `LIMIT ?` always appended, default 20
- `listMemories()` at `src/db.ts:424` — `LIMIT ?` always appended, default 50
- `searchObservations()` at `src/db.ts:273` — `LIMIT ?` always appended, default 20

MCP tools in `src/tools.ts`:
- `search_memories` at line 62: `z.number().default(20)`
- `list_memories` (line ~107): `z.number().default(50)`

### What to change

In each function, conditionally apply LIMIT:
```typescript
if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
}
```

Update MCP tool descriptions to document `0 = no limit`.

### Files to modify

| File | Lines | Change |
|------|-------|--------|
| `src/db.ts` | 273, 389, 424 | Conditional LIMIT clause |
| `src/tools.ts` | 62, ~107 | Update limit descriptions |
| `src/app.ts` | API query param parsing | Handle limit=0 |


## Feature 5: Settings UX Polish (Partially Done)

**Status:** ~40% complete. See `docs/plans/2026-03-04-settings-ux-polish.md`.

### What exists

- Domain/category count fields returned by backend (`listDomains()` at `src/db.ts:465`, `listCategories()`)
- Settings.tsx has 3-tab layout (config, domains, categories) at `src/ui/components/Settings.tsx:1`
- Worker config fields exposed in Settings UI (lines 16-30)

### What's missing

- Restore-defaults backend functions (`restoreDefaultDomains()`, `restoreDefaultCategories()`) in `src/db.ts`
- API endpoints: `/api/domains/restore-defaults`, `/api/categories/restore-defaults` in `src/app.ts`
- Help text for Domains and Categories tabs in Settings.tsx
- Unified single-button delete with conditional confirmation messaging
- Per-tab restore defaults footer with confirmation modal

### Files to modify

| File | Change |
|------|--------|
| `src/db.ts` | Export seed arrays, add restore functions |
| `src/app.ts` | Add restore-defaults endpoints |
| `src/ui/components/Settings.tsx` | Help text, delete UX, restore footers |


## Feature 6: Plugin Installation Fix

**Status:** Design only. See `docs/plans/2026-03-05-fix-plugin-installation-design.md`.

### What to change

- `scripts/setup.sh` — Use cascading diagnostic gates instead of monolithic install
- `scripts/build.sh` — Remove `sync-versions.sh` call (script doesn't exist in cache)
- `hooks/scripts/startup.sh` — Related startup flow improvements


## Build & Test

```bash
pnpm build          # Build server (tsup) + UI (vite)
pnpm dev:ui         # Vite dev server for dashboard hot reload
pnpm vitest run test/   # Run tests
```

Dashboard UI is SolidJS + Tailwind in `src/ui/`, built with Vite.
