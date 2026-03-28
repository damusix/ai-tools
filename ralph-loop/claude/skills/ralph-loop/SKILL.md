---
name: ralph-loop
description: >-
  This skill should be used when the user asks to "set up ralph", "create a ralph loop",
  "initialize ralph", "start a new ralph project", "run ralph", "write a ralph prompt",
  "configure ralph", "instantiate a ralph loop", or mentions autonomous coding loops,
  iterative AI agent development, or ralph-wiggum. Guides setup, initialization,
  prompt writing, and execution of the ralph autonomous coding loop system.
---

# Ralph Loop — Autonomous Coding Loop Skill

Ralph is a standalone zx script that drives AI coding agents (Claude, Amp, Codex, OpenCode)
through iterative development cycles. It is not a project dependency — it runs from anywhere
and operates on the current working directory.

The core idea: write a task prompt, ralph handles everything else — environment discovery,
context assembly, AI invocation, quality gates, git commits, and inter-iteration communication
via a status report.


## When to Use

- Setting up the ralph-wiggum Docker environment for the first time
- Initializing a new ralph loop inside any project folder
- Writing or refining a `docs/ralph-loop/ralph-prompt.md` for a task
- Configuring `docs/ralph-loop/ralph.config.yml` with quality checks and tool selection
- Troubleshooting a running ralph loop or interpreting status reports


## Prerequisites

The ralph-wiggum repository must be available at a known path. The Docker environment
provides all runtimes and tools. Verify the repository exists:

```
ls <ralph-wiggum-repo>/src/ralph.mjs
ls <ralph-wiggum-repo>/docker-compose.yml
```


## Setup: Docker Environment

To set up ralph for the first time:

1. Build and start the container:

    ```bash
    docker compose up -d --build
    ```

2. Enter the container:

    ```bash
    docker compose exec ralph-wiggum zsh
    ```

3. Verify ralph is available:

    ```bash
    ralph help
    ```

The container runs Debian Bookworm with Node.js 24, Python 3, Go, Rust, Ruby, and
comprehensive tooling. The entrypoint handles first-run setup automatically
(git identity, PATH, Oh My Zsh).

**Volume mounts:**

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `./home` | `/home/ralph` | Persistent home directory — project folders live here |
| `./src` | `/opt/ralph` | Ralph script and prompt templates |
| `./claude/skills` | `/home/ralph/.claude/skills` | Claude Code skills (live-editable) |
| `./claude/plugins` | `/home/ralph/.claude/plugins` | Claude Code plugins (live-editable) |


## Instantiate: New Ralph Loop

To initialize a ralph loop inside a project folder:

1. Navigate to the target project directory (must be a git repository):

    ```bash
    cd ~/project-name
    ```

2. Initialize ralph:

    ```bash
    ralph init
    ```

    This creates a `docs/ralph-loop/` directory with three files and commits them:
    - `docs/ralph-loop/ralph.config.yml` — loop configuration
    - `docs/ralph-loop/ralph-prompt.md` — task prompt template (edit this)
    - `docs/ralph-loop/ralph-status.md` — inter-iteration communication log

3. Edit `docs/ralph-loop/ralph-prompt.md` with the task description. See **Writing an Effective Prompt** below.

4. Edit `docs/ralph-loop/ralph.config.yml` to configure the tool, max iterations, and quality checks.
   See `references/config-reference.md` for all options.

5. Run the loop:

    ```bash
    ralph run
    ```

To reset for a new task cycle without re-initializing:

```bash
ralph new
```

This empties the status report, moves the anchor forward, and preserves the config.


## Writing an Effective Prompt

The prompt is the single most important input. Ralph assembles a three-layer sandwich —
preamble (auto-generated context) + user prompt + postamble (auto-generated instructions).
Write only the middle layer.

Structure each prompt with: **Goal** (what and why), **Tasks** (concrete checklist),
**Constraints** (what must not change), and **Done When** (verification criteria).
Be specific — name files, functions, and paths. Vague goals produce vague work.

For the full template, writing rules, and real-world examples, consult
`references/prompt-writing-guide.md`.


## Status Report Communication

The `docs/ralph-loop/ralph-status.md` file is the **only way iterations communicate** with each other.
Each iteration reads the current status and appends a new section — never overwrite
prior entries. The status report is injected into the preamble so future iterations
can see the full history of what was accomplished, what failed, and what remains.

For the entry format, classification rules, and guidance on reading and writing
status reports, consult `references/status-report-guide.md`.


## Quality Checks

Quality checks are bash commands that gate completion. When a check fails:

1. Working changes are stashed (not discarded)
2. Failure details are appended to the status report
3. Only the status update is committed
4. The next iteration can `git stash pop` to recover

Configure in `docs/ralph-loop/ralph.config.yml`:

```yaml
quality_checks:
  - npm test
  - npm run typecheck
```

The completion sigil `<promise>COMPLETE</promise>` is only honored when all quality
checks pass.


## Execution Flow

Each iteration follows four phases:

1. **Gather** — Load config, derive iteration count from git, read status report, resolve prompt files
2. **Compose** — Render preamble + user prompt + postamble with placeholder tokens
3. **Execute** — Invoke AI tool (retry 3x on failure), capture output
4. **Evaluate & Persist** — Run quality checks, commit work or stash on failure, check for completion sigil

The loop exits when:
- The completion sigil is detected AND all quality checks pass (exit 0)
- Max iterations reached (exit 1)


## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| `ralph init` | First-time setup in a git repo |
| `ralph new` | Reset loop cycle, keep config |
| `ralph run` | Execute the iteration loop |
| `ralph run --dry-run` | Print assembled prompt without invoking AI |
| `ralph run --verbose` | Suppress tool output summary line |
| `ralph run --tool amp` | Use a different AI tool |
| `ralph run --max 5` | Override max iterations |
| `ralph help` | Print usage |


## Additional Resources

### Reference Files

For detailed guidance beyond this overview, consult:

- **`references/prompt-writing-guide.md`** — Detailed prompt authoring patterns with real examples from production ralph loops
- **`references/status-report-guide.md`** — How to interpret, write, and troubleshoot status reports
- **`references/config-reference.md`** — Full configuration reference with all options, supported tools, and quality check patterns
