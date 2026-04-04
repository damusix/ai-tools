# Ralph Loop Lifecycle


## Initialize a New Loop

Navigate to a git repository and run:

```bash
ralph init
```

This creates `docs/ralph-loop/` with three files and commits them:

- `docs/ralph-loop/ralph.config.yml` — loop configuration
- `docs/ralph-loop/ralph-prompt.md` — task prompt template (edit this)
- `docs/ralph-loop/ralph-status.md` — inter-iteration communication log

After init:

1. Write the prompt — see `prompt-writing-guide.md` for the interactive workflow.
2. Configure quality checks and tool selection — see `config-reference.md`.
3. Run the loop: `ralph run`


## Reset for a New Task

```bash
ralph new
```

Empties the status report, moves the anchor forward, and preserves the config.
Use this between task cycles without re-initializing.


## Execution Flow

Each iteration follows four phases:

1. **Gather** — Load config, derive iteration count from git, read status report, resolve prompt files
2. **Compose** — Render preamble + user prompt + postamble with placeholder tokens
3. **Execute** — Invoke AI tool (retry 3x on failure), capture output
4. **Evaluate & Persist** — Run quality checks, commit work or stash on failure, check for completion sigil

The loop exits when:

- The completion sigil is detected AND all quality checks pass (exit 0)
- Max iterations reached (exit 1)


## Quality Checks

Quality checks are bash commands that gate completion. When a check fails:

1. Working changes are stashed (not discarded)
2. Failure details are appended to the status report
3. Only the status update is committed
4. The next iteration can `git stash pop` to recover

The completion sigil `<promise>COMPLETE</promise>` is only honored when all quality
checks pass. See `config-reference.md` for configuration.


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
