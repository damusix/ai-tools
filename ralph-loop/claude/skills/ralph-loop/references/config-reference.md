# Ralph Configuration Reference

All configuration lives in `docs/ralph-loop/ralph.config.yml` in the project root.
CLI flags override config values. Config values override defaults.


## Full Configuration

```yaml
# ralph.config.yml

# AI tool to invoke. Options: claude, amp, codex, opencode
tool: claude

# Maximum iterations before the loop exits with code 1
max_iterations: 10

# Git commit SHA marking the start of the current loop cycle.
# Managed by ralph — do not edit manually.
anchor: a1b2c3d4e5f6789...

# Prompt file(s). Supports globs. Concatenated in order.
prompt:
  - docs/ralph-loop/ralph-prompt.md

# Status report file path. Inter-iteration communication.
status: docs/ralph-loop/ralph-status.md

# Bash commands that must pass before a commit is accepted.
# On failure: work is stashed, status updated, loop continues.
quality_checks:
  - npm test
  - npm run typecheck
```


## Fields

### tool

The AI coding tool to invoke. Each tool is called differently:

| Tool | Invocation |
|------|-----------|
| `claude` | `cat prompt.md \| claude --dangerously-skip-permissions --print` |
| `amp` | `cat prompt.md \| amp --dangerously-allow-all` |
| `codex` | `cat prompt.md \| codex exec --dangerously-bypass-approvals-and-sandbox` |
| `opencode` | `opencode run --file prompt.md "Follow the instructions..."` |

Default: `claude`

### max_iterations

Maximum number of iterations before the loop exits with code 1. The iteration count
is derived from git commit messages matching `ralph(iteration-` in the range `anchor..HEAD`.

Default: `10`

### anchor

A git commit SHA that marks the start of the current loop cycle. All git context
(log, diff, iteration count) is scoped to `anchor..HEAD`.

- Set automatically by `ralph init` and `ralph new`
- Do not edit manually
- Must be reachable by git (ralph creates a separate anchor commit to ensure GC survival)

### prompt

One or more file paths (supports globs) containing the user's task description.
Files are resolved relative to CWD and concatenated in order with `---` separators.

```yaml
# Single file (default)
prompt:
  - docs/ralph-loop/ralph-prompt.md

# Multiple files — concatenated in order
prompt:
  - tmp/01-problem-statement.md
  - tmp/02-implementation-roadmap.md
  - docs/ralph-loop/ralph-prompt.md

# Glob pattern
prompt:
  - "prompts/*.md"
```

Default: `['docs/ralph-loop/ralph-prompt.md']`

### status

Path to the status report file. This is the inter-iteration communication channel.

Default: `docs/ralph-loop/ralph-status.md`

### quality_checks

Array of bash commands that must all pass (exit code 0) for a commit to be accepted.
Checks run in order; the first failure stops the sequence.

```yaml
# No checks (default)
quality_checks: []

# Test suite only
quality_checks:
  - npm test

# Multiple checks
quality_checks:
  - npm run typecheck
  - npm test
  - npm run lint

# Python project
quality_checks:
  - uv run pytest -v

# Custom check script
quality_checks:
  - bash scripts/validate.sh
```

When a check fails:
1. All working changes are stashed
2. Failure details (command + first 50 lines of output) appended to status report
3. Only the status update is committed
4. Next iteration can `git stash pop` to recover and fix

Default: `[]` (no checks)


## CLI Overrides

CLI flags take precedence over config values:

| Flag | Overrides | Example |
|------|-----------|---------|
| `--tool <name>` | `tool` | `ralph run --tool amp` |
| `--max <n>` | `max_iterations` | `ralph run --max 25` |
| `--prompt <paths>` | `prompt` | `ralph run --prompt "tasks/*.md"` |
| `--status <path>` | `status` | `ralph run --status my-status.md` |
| `--config <path>` | config file path | `ralph run --config custom.yml` |
| `--dry-run` | — | Print assembled prompt, do not invoke AI |
| `--verbose` | — | Stream first 300 chars of tool output |


## Prompt Assembly Tokens

The preamble and postamble templates use `{{PLACEHOLDER}}` tokens rendered at runtime:

| Token | Value |
|-------|-------|
| `{{ITERATION}}` | Current iteration number (1-based) |
| `{{MAX_ITERATIONS}}` | Maximum iterations from config |
| `{{ENV_BLOCK}}` | Full environment discovery block (OS, tools, versions) |
| `{{GIT_LOG}}` | `git log --oneline anchor..HEAD` |
| `{{ANCHOR_LINE}}` | `git log --oneline -1 <anchor>` |
| `{{LAST_FILES}}` | `git diff-tree --name-status -r HEAD` |
| `{{STATUS_BLOCK}}` | Contents of the status report file |
| `{{STATUS_PATH}}` | Path to the status report file |
| `{{TIMESTAMP}}` | ISO 8601 timestamp at assembly time |

These tokens are used in the template files under `src/prompts/`. They are not
user-configurable — they are resolved automatically by ralph.


## Common Configuration Patterns

### Quick Prototyping (no quality gates)

```yaml
tool: claude
max_iterations: 5
prompt:
  - docs/ralph-loop/ralph-prompt.md
status: docs/ralph-loop/ralph-status.md
quality_checks: []
```

### Production Feature Development

```yaml
tool: claude
max_iterations: 25
prompt:
  - docs/ralph-loop/ralph-prompt.md
status: docs/ralph-loop/ralph-status.md
quality_checks:
  - npm run typecheck
  - npm test
```

### Long-Running Type System Work

```yaml
tool: claude
max_iterations: 100
prompt:
  - tmp/01-problem-statement.md
  - tmp/02-implementation-roadmap.md
  - docs/ralph-loop/ralph-prompt.md
status: docs/ralph-loop/ralph-status.md
quality_checks:
  - npm test
```

### Python Project

```yaml
tool: claude
max_iterations: 15
prompt:
  - docs/ralph-loop/ralph-prompt.md
status: docs/ralph-loop/ralph-status.md
quality_checks:
  - uv run pytest -v
  - uv run mypy src/
```


## Logging

Each `ralph run` invocation creates a log file at `tmp/ralph-<timestamp>.log` in the
project CWD. Logs capture:

- Configuration loaded
- Environment discovery results
- Prompt assembly details
- Tool invocation and output length
- Quality check results
- Commit details
- Errors and fatals

Logs use synchronous writes for crash safety.
