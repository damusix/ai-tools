# Ralph Prompt Writing Guide

The `docs/ralph-loop/ralph-prompt.md` file is the user-authored middle layer of a three-layer prompt sandwich.
Ralph auto-generates the preamble (environment, git context, status report) and postamble
(commit message, status update, completion sigil instructions). The user writes only the task.


## Prompt Template

```markdown
# Task Title

## Goal

One paragraph. What needs to be accomplished and why. Include enough context
for an agent with no memory of prior conversations to understand the task.

## Tasks

- [ ] First concrete, verifiable task
- [ ] Second concrete, verifiable task
- [ ] Third concrete, verifiable task

## Constraints

- What must NOT change
- What tools or frameworks to use
- What conventions to follow

## Done When

All tasks above are checked and every quality check passes.
```


## Writing Rules

### Be Specific

Name files, functions, and paths. Vague goals produce vague work.

**Bad:**
```markdown
## Goal
Fix the authentication system.
```

**Good:**
```markdown
## Goal
Replace passport.js with lucia-auth in `src/auth/`. Rewrite the session
middleware in `src/middleware/session.ts` and update all route handlers in
`src/routes/` that call `req.isAuthenticated()`.
```

### Include Verification Criteria

Define how to prove each task is complete. The agent cannot judge "done" without
concrete criteria.

**Bad:**
```markdown
- [ ] Fix the tests
```

**Good:**
```markdown
- [ ] Run `uv run pytest -v` — zero failures, no skipped tests
```

### Reference Source Files

List files the agent should read before modifying. This prevents blind edits.

```markdown
## Approach

Files to read and verify before making changes:
- `src/downloader/config.py` — does `Target.output_dir` default to `Path("scraped")`?
- `src/downloader/fs.py` — does `url_to_local_path(url, output_dir)` handle absolute paths?
- `src/downloader/downloader.py` — is `output_dir` threaded through `process_file`?
```

### Scope Tasks to Commit-Sized Chunks

Each checklist item should represent roughly one iteration's worth of work.
The postamble instructs the agent: "Work on ONE meaningful unit of progress per
iteration. Commit-sized chunks."

**Too large:**
```markdown
- [ ] Implement the entire authentication system
```

**Right-sized:**
```markdown
- [ ] Install lucia and remove passport from package.json
- [ ] Rewrite session middleware in src/middleware/session.ts
- [ ] Update route handlers in src/routes/ to use lucia
- [ ] Run full test suite — all tests pass
```

### Set Constraints Explicitly

What must NOT change? What tools to use? What conventions to follow?

```markdown
## Constraints

- Fix type definitions in `lib/index.d.ts` only — do not modify runtime code
- All existing tests must continue to pass
- Use `uv` for all Python commands
- All git commits must use specific file paths, not `git add .`
- Do not modify existing passing tests — only add new ones
```

### Include a "Done When" Section

Make completion unambiguous. Reference quality checks and concrete verification commands.

```markdown
## Done When

All of the following demonstrated with actual command output in the status report:

1. All tasks above checked off
2. `uv run pytest -v` exits with zero failures
3. Integration test passes as part of the suite (not skipped)
4. `uv run python -c "from downloader.config import Target; ..."` prints `default OK`
```


## Multi-Prompt Support

Ralph supports multiple prompt files via config or CLI:

```yaml
prompt:
  - tmp/01-problem-statement.md
  - tmp/02-implementation-roadmap.md
  - docs/ralph-loop/ralph-prompt.md
```

Files are concatenated in order with `---` separators. Use this to split large contexts:
- Background/specification documents in numbered files
- The active task checklist in `docs/ralph-loop/ralph-prompt.md`

This keeps the task file clean while providing rich context.


## Status Reporting Instructions

Optionally include guidance for how the agent should report status. This shapes
what appears in `docs/ralph-loop/ralph-status.md` for future iterations.

```markdown
## Status Reporting

After each iteration, update `docs/ralph-loop/ralph-status.md` with:
- Which tasks were completed
- Test suite state (pass/fail count)
- Any blockers or implementation fixes made
```


## Self-Updating Prompts

For long-running loops (many iterations), instruct the agent to update the prompt
itself as tasks complete. This keeps the task list accurate across iterations.

```markdown
## Notes

- At the end of each task, update this `docs/ralph-loop/ralph-prompt.md` with completed tasks.
- Only add [x] to tasks you have completed.
- If something is impossible, strike it out and explain why in a sub-bullet.
- Do not add any other text or comments to this file.
- DO NOT mark a task as complete if `npm test` fails. Fix the failure first.
```


## Real-World Example: Feature Verification

From a production ralph loop testing the `output_dir` feature of a web scraper:

```markdown
# Verify and Test output_dir Feature

## Goal

The `output_dir` feature lets users specify where downloaded files are written.
`scraped/` is the default (relative to CWD). Users can override it per-target
in `config.yml` with any absolute or relative path.

This task verifies the existing implementation is correct and complete, adding
tests to prove it works. Fix anything broken before writing tests.

## Feature Specification

### How `output_dir` works

- **Default:** no `output_dir` in config → files go to `scraped/<domain>/<path>/filename`
- **Relative path:** `output_dir: custom/output` → files go to `custom/output/<domain>/...`
- **Absolute path:** `output_dir: /some/absolute/path` → files go there exactly

## Approach

**Treat the existing code as potentially unfinished.** Read every relevant source
file before writing tests. If the implementation is wrong or incomplete, fix it first.

Files to read and verify:
- `src/downloader/config.py` — does `Target.output_dir` default correctly?
- `src/downloader/fs.py` — does `url_to_local_path` handle all path types?
- `src/downloader/downloader.py` — is `output_dir` threaded through correctly?

## Tasks

- [ ] Read and verify all source files listed above
- [ ] Fix any implementation issues found
- [ ] Add unit tests to `tests/test_config.py` covering default, relative, absolute
- [ ] Add unit tests to `tests/test_fs.py` covering path mapping
- [ ] Write integration test in `tests/test_integration.py`
- [ ] Run full test suite: `uv run pytest -v`
- [ ] Update README.md with output_dir documentation

## Constraints

- Use `uv` for all Python commands
- Do not modify existing passing tests — only add new ones

## Done When

1. All tasks checked off
2. `uv run pytest -v` exits with zero failures
3. Integration test passes (not skipped)
```


## Real-World Example: Type System Fix

From a production ralph loop fixing TypeScript type inference:

```markdown
# Joi TypeScript Type Inference — Fix Failing Type Tests

## Goal

Commit ca1b597 introduced `IsAny` and `IsUnknown` test utilities plus new tests
that verify `Joi.object().keys({...})` infers concrete types instead of `any`.
Fix the type definitions in `lib/index.d.ts` so all tests pass.

## Known Broken Inference

1. **`Joi.object().keys({...})` infers `any`**: When `Joi.object()` is called
   with no arguments, `TShape` defaults to `null`. The `keys()` typed overload
   guards with `null extends TShape ? never : TNew`, which blocks when TShape
   is null.

## Tasks

- [ ] Add `IsAnyType` utility to `lib/index.d.ts`
- [ ] Add a `keys()` overload for `ObjectSchema` that handles `TShape = null`
- [ ] Verify all tests pass including new `IsAny`/`IsUnknown` assertions

## Constraints

- Fix type definitions in `lib/index.d.ts` only — do not modify runtime code
- All existing tests must continue to pass
- DO NOT mark a task as complete if `npm test` fails

## Done When

All tasks above are checked and every quality check passes.
```


## Anti-Patterns

### Too Vague

```markdown
## Goal
Make the app better.

## Tasks
- [ ] Fix stuff
- [ ] Add tests
```

No files named, no verification criteria, no constraints. The agent will hallucinate scope.

### Too Ambitious

```markdown
## Tasks
- [ ] Rewrite the entire backend from Express to Hono
- [ ] Migrate the database from Postgres to SQLite
- [ ] Add authentication, authorization, and rate limiting
```

Each task is weeks of work. Break into focused prompts with `ralph new` between cycles.

### Missing Constraints

```markdown
## Goal
Add TypeScript types to the project.
```

Which files? What strictness level? Should runtime code change? Without constraints,
the agent may modify files it should not touch.
