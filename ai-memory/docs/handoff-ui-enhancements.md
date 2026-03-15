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

All features from this handoff are **complete**.


## Completed Features (This Session)

- **URL-based routing** — Modal open/close and Settings tab synced with URL query params (`?settings=config|domains|categories`, `?merge`, `?help=topic`, `?logs`). Browser back/forward works via pushState/popstate. Commit `4ab7f79`.
- **Settings UX polish** — All items complete: help text, AI generate explanation, unified delete with confirmation, per-tab restore defaults footer, restore-defaults backend+endpoints.
- **Plugin installation fix** — Cascading diagnostic gates in setup.sh, sync-versions removed from build.sh, startup.sh always calls setup.
- **Flaky test fix** — Root cause: config tests deleted the entire `tmp/` parent directory, racing with other test files. Fix: all 5 test files now use `mkdtempSync` for unique isolated temp directories. Commit `5515246`.


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
