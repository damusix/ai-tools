# ralph — autonomous coding loop

Ralph is a standalone [zx](https://google.github.io/zx/) script that drives AI coding agents through iterative development cycles. It is not a project dependency — it runs from anywhere and operates on the current working directory.


## Why Ralph

AI agents are powerful but impatient. Give one a big task and it will try to do everything at once — editing 15 files, losing track of what it changed, and producing work that half-works. The longer a single agent session runs, the more context it burns and the worse its decisions get.

Ralph solves this by splitting work into **iterations**. Each iteration gets a fresh agent session with a single job to do. When it finishes, it writes a status report describing what it accomplished and what remains. The next iteration reads that report and picks up where the last one left off.

This means:

- **Each agent call is focused.** One task, one commit, one status update. The agent is not juggling ten things.
- **Context stays fresh.** Instead of a single session drowning in accumulated context, each iteration starts clean with only the information it needs: the original prompt, the status history, and the git diff.
- **Failures are isolated.** A bad iteration gets stashed, the failure is logged to the status report, and the next iteration can recover. Broken code never enters the commit log.
- **You can walk away.** Ralph handles the loop — invoke the agent, check its work, commit, repeat. You write the prompt and come back when it's done.


## When to Use It

Ralph is the right tool when your task is **decomposable into ordered steps** where each step produces a meaningful commit.

**Good fits:**

- Multi-file refactors (rename a concept across the codebase, one layer at a time)
- Feature implementation with clear phases (schema, API, UI, tests)
- Research and data gathering (crawl sources, compile findings, generate report)
- Code generation with validation (generate output, run a check script, fix failures)
- Migration tasks (upgrade dependency, update call sites, verify)

**Poor fits:**

- Quick one-off questions (just ask the agent directly)
- Tasks that cannot be meaningfully split into steps
- Exploratory work where you don't know what "done" looks like yet


## Prerequisites

Ralph runs inside a Docker container that comes pre-loaded with everything you need. You only need two things on your host machine:

- **Docker** and **Docker Compose** — to build and run the ralph-wiggum container
- **An API key** for your chosen AI tool (e.g., `ANTHROPIC_API_KEY` for Claude)

That's it. The container provides all runtimes, build tools, editors, search tools, and AI CLI tools. You do not need Node.js, Go, Rust, Python, or any other runtime installed locally — the dockerized environment handles everything.


## Quick Start

Build and start the container:

    docker compose up -d --build

Enter the container:

    docker exec -it ralph-wiggum zsh

From here, everything you need is already installed. Initialize a loop inside any git repo:

    cd ~/my-project
    ralph init               # scaffolds docs/ralph-loop/ with config, prompt, status
    vim docs/ralph-loop/ralph-prompt.md   # write your task
    ralph run                # start the loop

To reset for a new task (keeping your config):

    ralph new                # clears status, moves the anchor forward
    vim docs/ralph-loop/ralph-prompt.md   # write the new task
    ralph run


## Writing Effective Prompts

The prompt is the most important input. Ralph wraps it with auto-generated context (environment, git history, prior status reports) and instructions (commit message format, status report format, completion signal). You write only the task itself.

### Think in iterations, not in one shot

The key insight: **each numbered task in your prompt is roughly one iteration.** The agent reads your checklist, sees what prior iterations already completed (via the status report), and works on the next unchecked item.

Write your tasks as a checklist. Order them so each step builds on the last. Be specific — name files, functions, and paths. Vague goals produce vague work.

    # Migrate auth from Passport to Lucia

    ## Goal

    Replace passport.js with lucia-auth across the app. Each task below should be
    completed in its own iteration — do one, commit, move on.

    ## Tasks

    - [ ] Install lucia, @lucia-auth/adapter-postgres. Remove passport, passport-local, express-session.
    - [ ] Create src/lib/auth.ts — initialize lucia with the postgres adapter, export the instance.
    - [ ] Rewrite src/middleware/session.ts to use lucia sessions instead of express-session.
    - [ ] Update all route handlers in src/routes/auth/ to use the new auth module.
    - [ ] All existing tests pass. Fix any broken imports or assertions.

    ## Constraints

    - Do not change the public API surface (request/response shapes stay the same)
    - Use the postgres adapter, not SQLite
    - Do not modify the database schema — lucia must work with the existing tables

    ## Done When

    All tasks checked and `npm test` passes.

### When to add quality checks

If your task produces output that can be verified programmatically, add a quality check. The check runs after every iteration — if it fails, the agent's work is stashed (not lost) and the failure details are written to the status report so the next iteration can fix it.

**Use quality checks when:**

- You're generating code that must compile or pass a type checker
- You're producing structured data that must match a schema
- You're crawling or scraping and need to verify completeness
- You have any deterministic "this must be true" condition

**Don't bother when:**

- The output is prose or research with no strict format
- The check would just be "does the file exist" (the agent already knows)

```yaml
quality_checks:
    - npm run typecheck
    - npm test
    - node scripts/validate-output.js
```

Quality checks are bash commands. If the command exits non-zero, the check fails. Keep them fast — they run every iteration.

### Splitting prompts across files

For complex tasks, split your prompt into multiple files. Ralph concatenates them in order. This is useful when one part is stable context (a spec, a reference document) and another part is the active task list.

```yaml
prompt:
    - docs/ralph-loop/spec.md
    - docs/ralph-loop/ralph-prompt.md
```

The spec stays fixed while you edit the task list between cycles.


## Commands

| Command | Purpose |
|---------|---------|
| `ralph init` | First-time setup — creates `docs/ralph-loop/` with config, prompt, and status files |
| `ralph new` | Reset for a new task — clears status, moves the anchor forward |
| `ralph run` | Execute the iteration loop |
| `ralph run --dry-run` | Print the assembled prompt without invoking the AI tool |
| `ralph run --tool amp` | Use a different AI tool (amp, codex, opencode) |
| `ralph run --max 5` | Override max iterations |
| `ralph help` | Print usage |


### Options

    --prompt <paths>    Override prompt file(s), supports globs
    --status <path>     Override status report path
    --tool <name>       AI tool: claude | amp | codex | opencode
    --max <n>           Max iterations (default: 50)
    --dry-run           Print the assembled prompt, do not invoke AI
    --verbose           Suppress the post-invocation summary line
    --config <path>     Config file path (default: ./docs/ralph-loop/ralph.config.yml)

CLI flags override config. Config overrides defaults.


## Configuration

    # docs/ralph-loop/ralph.config.yml
    tool: claude
    max_iterations: 50
    anchor: a1b2c3d4e5f6       # managed by ralph — do not edit
    prompt:
      - docs/ralph-loop/ralph-prompt.md
    status: docs/ralph-loop/ralph-status.md
    quality_checks:
      - npm run typecheck
      - npm run test


## How It Works

### The iteration loop

Each iteration follows four phases:

1. **Gather** — Load config, derive iteration count from git, read the status report, resolve prompt files.
2. **Compose** — Build a three-layer prompt: auto-generated preamble (environment, git context, status history) + your prompt + auto-generated postamble (commit/status/completion instructions).
3. **Execute** — Invoke the AI tool. Retry up to 3 times on failure.
4. **Evaluate** — Run quality checks. If all pass, commit the work. If any fail, stash the changes and log the failure to the status report. If the agent signals completion and all checks pass, exit.

### Real-time output

Ralph streams real-time output to your terminal while the AI agent works. When using Claude, ralph invokes it with `--output-format stream-json` and `--include-partial-messages`, which gives you live visibility into:

- **Text responses** as they are generated, flushed on sentence boundaries
- **Tool calls** with their names and inputs (e.g., `[tool: Edit] {"file_path": ...}`)
- **Elapsed timestamps** on every line so you can track how long each step takes

All output is also written to a per-invocation tool log at `docs/ralph-loop/logs/tool-<timestamp>.log` for post-run review.

For non-Claude tools (amp, codex, opencode), output is captured to the tool log file.

### The status report

The status report (`docs/ralph-loop/ralph-status.md`) is how iterations talk to each other. Each iteration appends a section describing what it accomplished, what failed, and what remains. The next iteration reads the full history before starting work.

You never write to this file. The agent does.

### The anchor

A commit SHA stored in config. It defines the boundary of the current loop cycle. Iteration count, git context, and completion detection are all scoped to `anchor..HEAD`. When you run `ralph new`, the anchor moves forward and the loop starts fresh.

### Quality gates

When a quality check fails:

1. Working changes are stashed (not discarded)
2. Failure details are appended to the status report
3. Only the status update is committed
4. The next iteration can `git stash pop` to recover

Broken code never enters the commit log.

### Who commits

The loop commits. The agent authors the message. The agent writes a one-line summary to `docs/ralph-loop/.ralph-commit-msg`, and ralph constructs:

    ralph(iteration-N): <agent's message>

### Prompt assembly

Ralph builds a three-layer sandwich. You write only the middle layer.

**Preamble** (auto-generated):

- Iteration number and max
- Full environment block (OS, shell, tools, versions)
- Git log scoped to `anchor..HEAD`
- Status report contents

**Your prompt** (one or more files, concatenated).

**Postamble** (auto-generated):

- Instructions for writing the commit message and status update
- Completion signal format

### Environment discovery

Runs once at process start. Probes ~50 tools in parallel (3s timeout each) and injects the results into the preamble so the agent knows exactly what is available — runtimes, package managers, search tools, build tools, everything.

### Logging

Each invocation creates a per-run log at `docs/ralph-loop/logs/ralph-<timestamp>.log`. Logs capture config, environment, prompt assembly, tool invocation, quality checks, and commits.

### Project layout

All ralph-generated files live in `docs/ralph-loop/` so they are easy to gitignore or exclude:

    docs/ralph-loop/
    ├── ralph.config.yml        # loop configuration
    ├── ralph-prompt.md         # your task (you edit this)
    ├── ralph-status.md         # inter-iteration communication
    ├── .ralph-commit-msg       # agent's commit message (ephemeral)
    └── logs/                   # per-run log files

Ralph's own source lives separately and is never copied into the project:

    src/
    ├── ralph.mjs               # the script
    └── prompts/                # prompt templates
        ├── preamble.md
        ├── postamble.md
        ├── init-prompt.md
        ├── init-status.md
        └── first-iteration.md


## Monitoring Long-Running Loops

Even with real-time streaming, you may want deeper visibility into token usage and cost while the loop runs. Install [claude-monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) inside the container:

    uv tool install claude-monitor

Then open a second terminal into the container and run:

    docker exec -it ralph-wiggum zsh
    claude-monitor

![Claude Code Usage Monitor](https://raw.githubusercontent.com/Maciek-roboblog/Claude-Code-Usage-Monitor/main/doc/scnew.png)

This gives you real-time visibility into cost, token usage, messages, burn rate, model distribution, and time-to-reset — so you can track spend across iterations.


## Docker Environment

The ralph-wiggum container is based on Debian Bookworm and comes with everything needed to execute. You do not need to install any runtimes or tools on your host — the container is self-contained.

**Runtimes:**

- Node.js 24, Python 3, Go 1.26, Rust (via rustup), Ruby

**Build tools:**

- gcc, make, cmake, autoconf, automake

**Search & discovery:**

- ripgrep, fd, fzf, ag, mlocate, tree

**Text processing:**

- sed, awk, jq, yq

**Editors:**

- vim, neovim, nano

**Shell:**

- zsh with Oh My Zsh (agnoster theme)

**Networking:**

- curl, wget, ssh, netcat, socat

**Monitoring:**

- htop, lsof, strace

**AI tools:**

- Claude Code (native installer), opencode-ai, tessl

**npm globals:**

- zx

The ralph user has passwordless sudo and zsh as the default shell.

### docker-compose.yml

    services:
      ralph-wiggum:
        build:
          context: .
          dockerfile: Dockerfile
        container_name: ralph-wiggum
        hostname: ralph-wiggum
        stdin_open: true
        tty: true
        volumes:
          - ./home:/home/ralph
          - ./src:/opt/ralph
          - ./claude/skills:/home/ralph/.claude/skills
          - ./claude/plugins:/home/ralph/.claude/plugins
        environment:
          - TERM=xterm-256color
        restart: unless-stopped

Four bind mounts:

- `./home` → `/home/ralph` — persistent home directory (survives rebuilds)
- `./src` → `/opt/ralph` — ralph script and prompts (editable from host)
- `./claude/skills` → `/home/ralph/.claude/skills` — Claude Code skills (live-editable)
- `./claude/plugins` → `/home/ralph/.claude/plugins` — Claude Code plugins (live-editable)

### Usage

    docker compose up -d          # start the container
    docker exec -it ralph-wiggum zsh   # interactive shell
    docker compose down           # stop

The container runs `sleep infinity` and is accessed via `docker exec`. The entrypoint handles first-run setup (git identity, ~/bin symlink, Oh My Zsh, PATH) using a sentinel file (`~/.ralph-initialized`) so it only runs once.
