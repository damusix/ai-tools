# Bug Fix Batch: Stats, Domain Validation, Project Rendering, Dropdown Refresh

Date: 2026-03-12


## Bug 1: Memories saved without domain

**Root cause:** `insertMemory()` in `db.ts` validates category but not domain. MCP tool schema marks domain as optional, DB allows NULL.

**Fix:**
- `db.ts` `insertMemory()`: Add domain validation when provided — validate against `listDomainsRaw()` same as category.
- `tools.ts` `save_memory`: Make domain required with `.default('general')` instead of `.optional()`.
- `db.ts` `updateMemory()`: Add same domain validation.


## Bug 2: Stats up top are wrong

**Root cause:** Header shows `memories()?.length` which counts the capped limit=100 result set, not actual totals.

**Fix:**
- `db.ts`: Add `getStats(projectPath?)` function returning `{ memories: number, observations: number }` via `SELECT COUNT(*)`.
- `app.ts`: Add `GET /api/stats?project=X` endpoint.
- `App.tsx`: Add `createResource` for stats, display real totals in header instead of array length. Refetch on `refreshKey` changes.


## Bug 3: New projects don't render on main page

**Root cause:** `groupedMemories` only creates entries for projects in the memories result set. Projects with 0 memories are invisible.

**Fix:**
- `App.tsx` `groupedMemories` memo: After building from memories, merge in projects from the `projects` resource that are missing — add them as empty `ProjectMemoryGroup` entries so they render.


## Bug 4: Project dropdown doesn't update for new projects

**Root cause:** `/enqueue` calls `getOrCreateProject()` which may create a new project but never broadcasts an SSE event.

**Fix:**
- `app.ts` `/enqueue` handler: Check if project existed before calling `getOrCreateProject()`. If newly created, broadcast `counts:updated` event.


## Files to modify

| File | Changes |
|------|---------|
| `src/db.ts` | Add domain validation in `insertMemory()`/`updateMemory()`, add `getStats()` function |
| `src/tools.ts` | Make domain required with default `'general'` in `save_memory` schema |
| `src/app.ts` | Add `/api/stats` endpoint, broadcast on new project creation in `/enqueue` |
| `src/ui/App.tsx` | Use stats resource for header counts, merge empty projects into `groupedMemories` |
