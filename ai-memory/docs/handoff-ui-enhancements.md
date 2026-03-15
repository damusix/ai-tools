# Handoff: UI & Feature Enhancements


## Goal

Remaining UI and feature improvements for the ai-memory dashboard.


## What's Already Done

These features from the original handoff are **complete** — do not re-implement:

- **Per-domain stats** — Domain headers show memory counts (commits `5961a01`, `6474416`)
- **limit=0 unlimited results** — `db.ts` query functions use `if (limit > 0)` guards, MCP tool default for `list_memories` increased to 500
- **Header restructure** — Two-row header (brand+actions / project+search), action buttons collapsed into Menu dropdown
- **Search bar** — Unified search + Datadog-style filter picker (domains/categories/tags), filter pills, debounced execution
- **ProjectSelector** — Rewritten as typeahead combobox with keyboard navigation and stats
- **Branding** — Custom copper brain logo, brand colors
- **State persistence** — Search text, filter pills, and accordion collapse state survive page refreshes via localStorage
- **Rename Transfer → Merge projects** — UI labels, modal, and help text updated
- **shadcn-solid migration** — Removed from roadmap. Custom SolidJS + Tailwind approach is staying.


## Remaining Features


### Feature 1: URL-Based Routing

**Status:** NOT STARTED. No router dependency installed.

Settings, Transfer (now "Merge projects"), and Help modals are controlled by in-memory SolidJS signals. Browser back/forward doesn't work with modals.

**Recommended approach:** Lightweight URL params (no new dependency). Use `URLSearchParams` + `window.location.search` to sync modal state:
- `?settings=config` opens Settings to config tab
- `?merge=true` opens Merge projects modal

**Files to modify:**

| File | Change |
|------|--------|
| `src/ui/App.tsx` | Sync modal signals with URL params |
| `src/ui/components/Settings.tsx` | Sync tab signal with URL params |
| `src/ui/components/TransferModal.tsx` | Sync open/close with URL params |


### Feature 2: Settings UX Polish (Partially Done)

**Status:** ~40% complete. See `docs/plans/2026-03-04-settings-ux-polish.md`.

**What exists:**
- Domain/category count fields returned by backend
- Settings.tsx has 3-tab layout (config, domains, categories)
- Worker config fields exposed in Settings UI

**What's missing:**
- Restore-defaults backend functions (`restoreDefaultDomains()`, `restoreDefaultCategories()`) in `src/db.ts`
- API endpoints: `/api/domains/restore-defaults`, `/api/categories/restore-defaults` in `src/app.ts`
- Help text for Domains and Categories tabs in Settings.tsx
- Unified single-button delete with conditional confirmation messaging
- Per-tab restore defaults footer with confirmation modal

**Files to modify:**

| File | Change |
|------|--------|
| `src/db.ts` | Export seed arrays, add restore functions |
| `src/app.ts` | Add restore-defaults endpoints |
| `src/ui/components/Settings.tsx` | Help text, delete UX, restore footers |


### Feature 3: Plugin Installation Fix

**Status:** Design only. See `docs/plans/2026-03-05-fix-plugin-installation-design.md`.

- `scripts/setup.sh` — Use cascading diagnostic gates instead of monolithic install
- `scripts/build.sh` — Remove `sync-versions.sh` call (script doesn't exist in cache)
- `hooks/scripts/startup.sh` — Related startup flow improvements


### Feature 4: Flaky Test Fix

**Status:** Pre-existing. Two tests fail intermittently with `SqliteError: disk I/O error` or `directory does not exist`:
- `test/domains.test.ts` — "should create domains table with seeded data"
- `test/context-domains.test.ts` — "should group memories by domain with headers"

Root cause: race condition in tmp directory setup for test databases. 98/100 tests pass consistently.


## Build & Test

```bash
pnpm build              # Build server (tsup) + UI (vite)
pnpm dev:ui             # Vite dev server for dashboard hot reload
pnpm vitest run test/   # Run tests
```

Dashboard UI is SolidJS + Tailwind in `src/ui/`, built with Vite.

**Deployment to plugin cache** (for testing live changes):
```bash
cp -r dist/* ~/.claude/plugins/cache/damusix-ai-tools/ai-memory/1.1.1/dist/
curl -s -X POST http://localhost:24636/api/restart
```
