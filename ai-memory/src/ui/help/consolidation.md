When you open Claude Code in a subfolder of a git project, ai-memory creates a separate project for that subfolder. This fragments your memories across multiple entries that really belong to one project.

**Git-root consolidation** fixes this by automatically merging subfolder projects into the git root project.

## How it works

A background worker periodically detects the git root for each project. When consolidation is enabled and a project is a subfolder of a git repo, the worker:

1. Moves all memories, observations, and queues to the root project
2. Tags each moved memory with `subpath:path/to/subfolder` so you can trace where it came from
3. Deletes the subfolder project entry

## Settings

**Global default** — Set `projects.consolidateToGitRoot: true` in `~/.ai-memory/config.yaml` to enable for all projects. Off by default.

**Per-project override** — Use the three buttons next to the consolidation label:

- **Default** — follows the global setting
- **Always** — always consolidate this project into its git root, regardless of global setting
- **Never** — never consolidate this project (use this for monorepos where you want separate projects per subfolder)

## Monorepos

If you work in a monorepo like `my-company/apps/frontend` and `my-company/apps/backend`, set the monorepo root project to **Never**. This prevents subfolder projects from being merged, keeping your memories separate per workspace.
