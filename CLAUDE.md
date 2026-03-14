# CLAUDE.md


## Repository Structure

This is a pnpm workspace monorepo containing Claude Code plugins and shared tooling.

```
ai-memory/              — Persistent memory plugin (Node.js, see ai-memory/CLAUDE.md)
cc-auto-approve-fix/    — Auto-approve compound Bash commands plugin (Go)
scripts/cli/            — Versioning CLI (Bun, TypeScript)
.claude-plugin/
    marketplace.json    — Central plugin registry (names, versions, sources)
```


## Commands

```
pnpm dev version                          # Interactive version bump (multi-plugin)
pnpm dev version <plugin> <bump>          # Flag mode: bump a single plugin
pnpm dev version ai-memory patch          # Example: ai-memory 1.0.0 → 1.0.1
pnpm dev version auto-approve-compound-bash minor
```


## Versioning CLI

Located at `scripts/cli/`, invoked via `pnpm dev`. Uses Bun runtime.

**Plugin names** come from `.claude-plugin/marketplace.json`, not directory names:
- `ai-memory` (dir: `ai-memory/`)
- `auto-approve-compound-bash` (dir: `cc-auto-approve-fix/`)

**Version source of truth** per plugin:
- If `<plugin>/package.json` has a `version` field → that's the source (e.g., `ai-memory`)
- Otherwise → `<plugin>/.claude-plugin/plugin.json` (e.g., `auto-approve-compound-bash`)

**What `pnpm dev version` does:**
1. Bumps the version in the source-of-truth file
2. Syncs version to `.claude-plugin/marketplace.json`
3. Syncs version to `<plugin>/.claude-plugin/plugin.json` (if separate from source)
4. Regenerates `<plugin>/CHANGELOG.md` from git history (conventional commits)
5. Commits all changes as `release: <plugin>@<version>`
6. Creates git tag `<plugin>@<version>`

**Interactive mode** (`pnpm dev version` with no args): multiselect plugins → pick bump type per plugin → confirm → execute. Multi-plugin bumps produce a single commit with one tag per plugin.

**Flag mode** (`pnpm dev version <plugin> <bump>`): validates inputs, checks clean working tree, bumps, commits, tags.

**Exit codes:** 0 = success, 1 = user error, 2 = system error.

**Requires clean working tree** — commit or stash before running.


## Development Workflow

**Adding a new plugin to the repo:** Add an entry to `.claude-plugin/marketplace.json` with `name`, `version`, and `source` fields. Add the directory to `pnpm-workspace.yaml`. The versioning CLI discovers plugins from marketplace.json automatically.

**Adding a new CLI subcommand:** Create a new file in `scripts/cli/src/commands/`. Add routing in `scripts/cli/src/index.ts` (manual routing via positional args from `@bomb.sh/args`).

**Running CLI tests:**
```
cd scripts/cli && pnpm test
```


## Conventions

- Package manager: `pnpm`
- Do NOT use `timeout` — use `gtimeout`
- No AI bylines in commits
- Git tags for releases: `<plugin-name>@<version>`
- Changelogs generated from conventional commits (only `feat`, `fix`, and breaking changes)
