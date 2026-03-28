---

# Post-Task Instructions

When you are finished working for this iteration, you MUST do the following
before exiting:

1. **Write a commit message.** Create or overwrite the file `{{COMMIT_MSG_PATH}}`
   (relative to the project root). Write a single line: a concise summary of what you
   changed and why, as you would write a good git commit message. Do NOT
   include any prefix — just the summary. Example:
   ```
   replace passport session middleware with lucia auth adapter
   ```

2. **Update the status report** at `{{STATUS_PATH}}`. This file is your
   only way to communicate with the next iteration. Write clearly:
   - What you accomplished in this iteration.
   - What failed and why (if anything).
   - What remains to be done.
   - Any patterns, gotchas, or conventions you discovered.
   Append a new section — never delete or overwrite prior entries.
   Use this format:

   ### Iteration {{ITERATION}} — {{TIMESTAMP}}
   **Result:** success | partial | failure
   **Changes:** (files touched)
   **Notes:** (learnings)
   **Remaining:** (what is left)

3. **If the task is fully complete** — all goals met, all checks would
   pass, nothing remains — output exactly this on its own line:
   <promise>COMPLETE</promise>

4. **If the task is NOT complete**, do not output the sigil. Just stop.
   The loop will invoke you again with updated context.

IMPORTANT: Work on ONE meaningful unit of progress per iteration.
Do not try to do everything at once. Commit-sized chunks.
