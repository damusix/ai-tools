# Ralph Status Report Guide

The `docs/ralph-loop/ralph-status.md` file is the **only way iterations communicate** with each other.
Each iteration starts with a fresh context — no memory of prior work. The status report
is injected into the preamble and provides the complete history of what has been done.


## How It Works

1. Ralph reads `docs/ralph-loop/ralph-status.md` at the start of each iteration
2. The contents are injected into the preamble under "Current Status Report"
3. The postamble instructs the agent to append a new section after completing work
4. The agent appends — never overwrites or deletes prior entries
5. Ralph commits the updated status as part of the iteration's work


## Status Entry Format

Each iteration appends one section:

```markdown
### Iteration N — <ISO timestamp>
**Result:** success | partial | failure
**Changes:** (comma-separated list of files touched)
**Notes:** (learnings, gotchas, patterns discovered)
**Remaining:** (what is left to do)
```

The timestamp is provided by the postamble template via `{{TIMESTAMP}}`.


## What Makes a Good Status Entry

### Result Classification

- **success** — All planned work for this iteration completed, tests pass
- **partial** — Some work completed, but blockers or remaining items exist
- **failure** — Work attempted but quality checks failed or errors prevented progress

### Changes Field

List specific files touched. This helps future iterations understand what was modified
without reading the full git diff.

```
**Changes:** tests/test_config.py, tests/test_fs.py, tests/test_downloader.py, README.md
```

### Notes Field

Record discoveries that would not be obvious from the code alone:

```
**Notes:**
- Verified all source files: output_dir implementation was already correct
- Fixed pre-existing bug in test_main.py where fake_run_download_pool
  didn't accept the output_dir parameter
- All 70 tests pass (0 failures)
```

Good notes include:
- Bugs found and fixed (not just "fixed bugs")
- Surprising behavior or edge cases discovered
- Conventions observed in the codebase
- Test counts and verification results
- Decisions made and why

### Remaining Field

Be explicit about what is left. If nothing remains, say so clearly:

```
**Remaining:** None — all tasks complete
```

Or for partial completion:

```
**Remaining:**
- Integration test for absolute paths not yet written
- README documentation not started
- `uv run pytest -v` shows 2 failures in test_integration.py
```


## Quality Check Failure Entries

When a quality check fails, the loop itself appends a status entry (not the agent):

```markdown
### Iteration N — Quality Check Failure (appended by loop)
**check:** npm test
**output:** (first 50 lines of failure output)
**stashed:** yes — next iteration can `git stash pop` to recover
```

The next iteration should:
1. Read the failure details from the status report
2. Run `git stash pop` to recover the stashed work
3. Fix the issue that caused the quality check failure
4. Re-run the quality check to verify the fix


## Tool Error Entries

When the AI tool itself fails (crash, timeout, API error), the loop appends:

```markdown
### Iteration N — AI Tool Error (appended by loop)
**error:** (error message)
```

The next iteration starts fresh and should continue from where the last successful
iteration left off, as indicated by the status report.


## Reading Status Reports

When interpreting a status report at the start of an iteration:

1. **Read all entries** — not just the last one. The full history provides context.
2. **Check for stashed work** — if the last entry mentions a stash, pop it first.
3. **Identify remaining work** — the most recent "Remaining" field is the current todo list.
4. **Note patterns and gotchas** — prior iterations may have discovered important conventions.
5. **Check test counts** — track whether tests are passing/failing and the trend.


## First Iteration

On the first iteration, when the status report is empty (just the header `# Ralph Status Report`),
ralph substitutes a fallback message:

```
This is the first iteration. No prior work has been done.
Analyze the task below and begin working.
```


## Status Report Growth

Over many iterations, the status report grows. This is intentional — it provides
a complete audit trail. However, for very long loops (50+ iterations), the status
report may become large. In such cases:

- Each entry should remain concise
- Focus on what changed, not what was attempted
- Reference file names, not file contents
- Keep Notes to genuinely novel discoveries


## Real-World Example

From a 1-iteration loop that completed successfully:

```markdown
### Iteration 1 — 2026-03-19T08:04:44.709Z
**Result:** success
**Changes:** tests/test_config.py, tests/test_fs.py, tests/test_downloader.py,
tests/test_integration.py, tests/test_main.py, README.md
**Notes:**
- Verified all source files: output_dir implementation was already correct and
  complete across config.py, fs.py, downloader.py, crawler.py, and __main__.py
- Fixed pre-existing bug in test_main.py where fake_run_download_pool didn't
  accept the output_dir parameter (added since output_dir was threaded through)
- All 70 tests pass (0 failures)
- Integration tests exercise full pipeline (run_target) with mocked crawl4ai
  and httpx, verifying files land in correct directories for all three
  output_dir modes
- `uv run python -c "..."` verification prints `default OK`
**Remaining:** None — all tasks complete
```

This entry tells the next iteration (if there were one) everything it needs:
what was done, what was discovered, what the test state is, and that nothing remains.
