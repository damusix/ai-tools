# claude-marketplace

A monorepo for Claude Code plugins and standalone AI tooling. Install the marketplace for two practical plugins (persistent memory and safer Bash auto-approval), or use the standalone ralph-loop for autonomous multi-iteration coding.

## Quickstart

Add this marketplace, then install both plugins:

```shell
/plugin marketplace add damusix/ai-tools
/plugin install ai-memory@damusix-ai-tools
/plugin install auto-approve-compound-bash@damusix-ai-tools
```

## What you get

### `ai-memory`

Give Claude long-term project memory across sessions, with local-first storage and tools to organize context.

- Captures observations and synthesizes reusable memories
- Shares one memory service across Claude Code sessions
- Provides MCP tools for saving, searching, and organizing memory
- Includes dashboard UI to browse and manage memories
- Adds `/remember` and `/forget` slash commands

Docs: [`ai-memory/README.md`](./ai-memory/README.md)

### `auto-approve-compound-bash` (`cc-auto-approve-fix` source)

Auto-approve compound Bash commands safely by parsing each command segment against allow/deny rules.

- Uses a native Go shell parser (`mvdan.cc/sh/v3/syntax`) for AST-based checks
- Handles compound operators, substitutions, subshells, and nested `bash/sh/zsh -c`
- Falls through safely when uncertainty is detected
- Supports `--explain`, `simulate`, and `doctor` workflows
- Ships prebuilt binaries for `darwin/linux` and `amd64/arm64`

Docs: [`cc-auto-approve-fix/README.md`](./cc-auto-approve-fix/README.md)

## Standalone tools

### `ralph-loop`

An autonomous coding loop that drives AI agents (Claude, Amp, Codex, OpenCode) through iterative development cycles. Not a Claude Code plugin — ralph is a standalone [zx](https://google.github.io/zx/) script that runs inside a self-contained Docker environment.

- Splits large tasks into focused iterations — one job, one commit, one status update per cycle
- Each iteration starts with a fresh agent session, keeping context clean and decisions sharp
- Quality gates stash broken work and log failures so the next iteration can recover
- Streams real-time output (text, tool calls, timestamps) while the agent works
- Includes a Dockerfile with all runtimes and tooling pre-installed — nothing to configure on the host

```shell
docker compose up -d --build
docker exec -it ralph-wiggum zsh
cd ~/my-project && ralph init
```

Docs: [`ralph-loop/README.md`](./ralph-loop/README.md)


## Why this marketplace

- One setup path gives you both plugins immediately
- Plugin names are stable in the `damusix-ai-tools` marketplace catalog
- Memory stays local and command auto-approval remains rule-driven

## Contributing


This repo is a pnpm workspace. Install dependencies from the root:

```shell
pnpm install
```

### Versioning

Plugin versions are managed by a CLI tool at `scripts/cli/`. It bumps versions, syncs all manifest files, generates changelogs from git history, and creates git tags.

**Interactive mode** — select plugins and bump types via prompts:

```shell
pnpm dev version
```

**Flag mode** — bump a single plugin directly:

```shell
pnpm dev version ai-memory patch
pnpm dev version auto-approve-compound-bash minor
```

Plugin names come from `.claude-plugin/marketplace.json`, not directory names. The CLI requires a clean working tree before running.

What it does per plugin:
1. Bumps the version in the source-of-truth file (`package.json` or `plugin.json`)
2. Syncs version across `marketplace.json` and `plugin.json`
3. Regenerates `CHANGELOG.md` from conventional commits (`feat`, `fix`, breaking changes)
4. Commits as `release: <plugin>@<version>` and creates a git tag

### Adding a new plugin

1. Add the plugin directory to `pnpm-workspace.yaml`
2. Add an entry to `.claude-plugin/marketplace.json` with `name`, `version`, and `source`
3. The versioning CLI discovers it automatically

## License

MIT
