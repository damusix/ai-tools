# Git-Root Project Consolidation


## Problem

When Claude Code opens in a subfolder of a git project (e.g., `/myproject/src/backend`), ai-memory creates a separate project entry. Memories fragment across subfolder paths that logically belong to one project. Claude also changes directories mid-session, creating spurious project entries for subpaths it happens to `cd` into.


## Goals

1. Detect the git root and remote URL for every project automatically via a background worker.
2. Optionally consolidate subfolder projects into their git root project — moving memories, observations, and queues.
3. Make consolidation configurable: global default (off by default) + per-project override (always/never/default).
4. Preserve provenance: tag merged memories with `subpath:<relative>` so the original subfolder is searchable.
5. Backfill existing projects on first startup after update.


## Non-goals

- Changing the intake path (`startup.sh` / `getOrCreateProject` stay untouched).
- Real-time consolidation at request time (worker handles it asynchronously).
- Monorepo-aware workspace splitting (users who want subfolder separation disable consolidation for that project).


## Dependency: `zx`

Add `zx` as a production dependency (pin exact version, e.g., `"zx": "8.5.5"`, following the repo's no-caret convention). Use its `$` template literal with `{ quiet: true, nothrow: true, cwd: projectPath }` for git CLI calls. This replaces manual `child_process` usage and provides clean error handling via `.exitCode` and `.stdout`.


## Data model


### New columns on `projects`

| Column | Type | Purpose |
|--------|------|---------|
| `git_root` | TEXT NOT NULL DEFAULT '' | Absolute path to git repo root. Empty if not in a git repo or not yet detected. |
| `git_url` | TEXT NOT NULL DEFAULT '' | Remote origin URL. Empty if no remote or not yet detected. |
| `consolidate` | TEXT NOT NULL DEFAULT '' | Per-project override: `''` = follow global default, `'yes'` = force consolidation on, `'no'` = force consolidation off. |

Migrations follow the existing `PRAGMA table_info` idempotent pattern in `src/db.ts`.


### New config keys

```yaml
projects:
    consolidateToGitRoot: false    # global default — off to preserve existing behavior
    consolidateIntervalMs: 60000   # worker check interval (1 minute)
```

Nested under a new `projectsSchema` in `src/config.ts`, following the existing pattern (`workerSchema`, `contextSchema`, `architectureSchema`). Must also add `const projects = projectsSchema.parse(raw.projects ?? {})` inside `applyDefaults()` and include `projects` in its return object — this function manually constructs each section and does not auto-discover new schemas.


## Git detection

For a given project path, run two git commands using `zx`:

```typescript
import { $ } from 'zx';

const gitRoot = await $({ quiet: true, nothrow: true, cwd: path })`git rev-parse --show-toplevel`;
const gitUrl = await $({ quiet: true, nothrow: true, cwd: path })`git remote get-url origin`;
```

- If `gitRoot.exitCode !== 0`: not a git repo — store `git_root = ''`, `git_url = ''`.
- If `gitUrl.exitCode !== 0`: no remote — store `git_url = ''`, `git_root` still set.
- Store `gitRoot.stdout.trim()` and `gitUrl.stdout.trim()` on the project row.
- Only run detection once per project (skip if `git_root` is already populated).
- If the path does not exist on disk: skip detection entirely (leave `git_root` empty). Do not attempt re-detection for missing paths — the project will eventually be cleaned up by `deleteEmptyProjects`.


## Consolidation logic

### Resolution

For a given project, consolidation is **enabled** when:
- `project.consolidate === 'yes'`, OR
- `project.consolidate === ''` AND `config.projects.consolidateToGitRoot === true`

Consolidation is **disabled** when:
- `project.consolidate === 'no'`, OR
- `project.consolidate === ''` AND `config.projects.consolidateToGitRoot === false`


### Worker flow

Runs every `consolidateIntervalMs` (default 60s) in the existing worker poll loop. Compute the tick modulo as `Math.max(1, Math.round(consolidateIntervalMs / pollIntervalMs))` — the same pattern used by `summaryEvery` in `worker.ts`. Run on first tick regardless (`pollCount <= 1 || pollCount % consolidateEvery === 0`).

```
for each project where path != '_global':
    if git_root is empty and path exists on disk:
        detect git root + remote URL
        store on project row

    if git_root == '' or git_root == path:
        continue  (not in a repo, or IS the root)

    if consolidation disabled for this project:
        continue

    rootProject = getOrCreateProject(git_root)

    if rootProject.consolidate === 'no':
        continue  (root project explicitly opts out)

    copy git_root and git_url to rootProject if not already set

    compute relative = path relative to git_root (e.g., "src/backend")

    BEGIN TRANSACTION:
        for each memory in this project:
            append "subpath:<relative>" to its comma-separated tags string
        move memories, observations, observation_queue, memory_queue to rootProject
        delete this project
    COMMIT

    log('consolidation', `Merged ${path} → ${git_root} (${memCount} memories, ${obsCount} observations)`)
```

**Transaction safety:** The entire merge (tag update + record re-assignment + project delete) MUST be wrapped in a single `db.transaction()` call, following the pattern in `transferProject()`. This prevents orphaned records if the process crashes mid-merge.

**FTS sync:** The `memories_fts` and `memories_trigram` tables are maintained by `AFTER UPDATE ON memories` triggers, so direct `UPDATE memories SET tags = ...` statements will automatically keep search indexes in sync. No manual FTS maintenance needed.

**Tag format:** Tags are stored as a comma-separated string. Append `,subpath:<relative>` to the existing tags value. The `subpath:` prefix is a convention for this feature — collisions with manually-created `subpath:` tags are theoretically possible but negligible in practice.

**Concurrency note:** better-sqlite3 is synchronous and single-connection. The `processing` lock in the worker loop prevents re-entrance. HTTP requests (e.g., `save_memory`) operate on the same synchronous connection, so they serialize naturally with the worker transaction — no additional locking needed.

### Startup backfill

On first startup after update, existing projects will have `git_root = ''`. The worker's first pass will detect git roots for all projects. This happens naturally — no special backfill logic needed since the worker runs on a timer and processes all projects with empty `git_root`.

To make this faster on first run: the first tick should run git detection regardless of the interval timer (same pattern as the architecture scan first-tick optimization with `pollCount <= 1`).


## DB helpers

New exports from `src/db.ts`:

- `getProjectGitInfo(projectId)` → `{ gitRoot, gitUrl, consolidate }`
- `updateProjectGitInfo(projectId, { gitRoot, gitUrl })` — sets git_root and git_url
- `setProjectConsolidate(projectId, value: '' | 'yes' | 'no')` — sets per-project override
- `listProjectsForConsolidation()` → projects matching `WHERE path != '_global' AND (git_root = '' OR git_root != path)`, with all relevant fields


## API

- `PUT /api/projects/:id/consolidate` — body `{ consolidate: '' | 'yes' | 'no' }`. Updates the per-project override.
- Existing `GET /api/projects` already returns all columns (after migration adds the new ones to the SELECT in `listProjects()`).


## Dashboard UI

The project area in the dashboard gets a consolidation indicator:

- **When git info is detected:** Show git root path (shortened) and remote URL near the project header.
- **Consolidation toggle:** Three-state select or button group: "Default" / "Always consolidate" / "Never consolidate". Only shown for non-`_global` projects.
- **Minimal UI** — this is a settings-level control, not a primary feature. A small row below the project name or in the project edit area.


## Testing

- Unit test: git detection function with a temp directory initialized with `git init`.
- Unit test: consolidation logic — mock two projects with same git root, verify merge happens, verify tags added, verify source project deleted.
- Unit test: per-project override logic (all three states).
- Manual: enable global consolidation, open Claude in a subfolder, verify memories appear under git root project in dashboard.


## File changes

| File | Change |
|------|--------|
| `package.json` | Add `zx` dependency |
| `src/db.ts` | Add 3 column migrations, add git info helpers, update `listProjects()` SELECT |
| `src/config.ts` | Add `projectsSchema` with `consolidateToGitRoot` and `consolidateIntervalMs` |
| `src/worker.ts` | Add `checkGitConsolidation()` on interval, git detection via `zx` |
| `src/app.ts` | Add `PUT /api/projects/:id/consolidate` endpoint |
| `src/ui/App.tsx` | Add consolidation toggle + git info display in project area |
