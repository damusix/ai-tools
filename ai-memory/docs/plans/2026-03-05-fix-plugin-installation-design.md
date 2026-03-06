# Fix Plugin Installation from Cache


## Problem

Users cannot install `ai-memory` from the marketplace cache. Two issues:

1. `setup.sh` runs full `pnpm install` + `pnpm build` even when `node_modules/` and `dist/` already exist in the cache copy
2. `build.sh` crashes calling `../../scripts/sync-versions.sh` which doesn't exist in the cache (it lives at the marketplace repo root)
3. The `better-sqlite3` native addon is pre-compiled for the developer's machine and won't work on the user's Node.js/platform without a rebuild


## Solution

Three file changes with a cascading diagnostic approach.


### 1. `setup.sh` — Cascading diagnostic

Replace the monolithic install+build with three gated steps:

```bash
# 1. If no node_modules → install dependencies
if [ ! -d "$PLUGIN_ROOT/node_modules" ]; then
    pnpm install --frozen-lockfile
fi

# 2. If no native addon → rebuild better-sqlite3
if ! find "$PLUGIN_ROOT/node_modules/better-sqlite3" -name "*.node" 2>/dev/null | grep -q .; then
    pnpm rebuild better-sqlite3
fi

# 3. If no built server → run build
if [ ! -f "$PLUGIN_ROOT/dist/server.js" ]; then
    pnpm build
fi
```

Each gate is a fast file check. Expensive operations only run when needed.

Scenarios:
- **Fresh dev clone**: all three run
- **Cache install** (has node_modules + dist, wrong native addon): only step 2
- **Corrupted build**: steps 2 + 3
- **Already good**: nothing runs, exits immediately


### 2. `startup.sh` — Always call setup.sh

Remove the `if [ ! -f dist/server.js ]` guard around the setup call. The cascade makes it cheap when everything is already in order.


### 3. `build.sh` — Remove sync-versions

Remove the `sync-versions.sh` call (lines 17-18). Version syncing is a release concern, not a build concern. Will be moved to a git hook or CI step later.

Remaining build steps: tsup, copy prompts, vite build, copy help files.


## Files Changed

- `ai-memory/scripts/setup.sh`
- `ai-memory/scripts/build.sh`
- `ai-memory/hooks/scripts/startup.sh`
