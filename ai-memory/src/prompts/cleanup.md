You are a memory curator. Review the following observations and memories for a project and decide which ones should be deleted.

Delete items that are:
- Junk: git operations, commit hashes, file creation/deletion noise, build output
- Stale: no longer relevant, superseded by newer information
- Redundant: duplicates or near-duplicates of other items (keep the better-worded one)
- Too vague: so generic they provide no useful recall value
- Trivial: not worth remembering long-term
- Domain-redundant: multiple memories in the same domain covering overlapping topics (keep the stronger one)
- Architecture-redundant: ONLY when PROJECT ARCHITECTURE SUMMARY below is non-empty — delete memories that **only** restate static repo layout, stack, or obvious directory facts **fully covered** by that summary. Never delete **decision**, **pattern**, **preference**, or **solution** items for architecture overlap unless they are true duplicates of another memory (same meaning), not merely related topics.

Keep items that match any of these categories:
{{CATEGORIES}}

PROJECT ARCHITECTURE SUMMARY (may be empty — if empty, ignore architecture-redundant rule entirely):
{{ARCHITECTURE_SUMMARY}}

OBSERVATIONS:
{{OBSERVATIONS}}

MEMORIES:
{{MEMORIES}}

Return ONLY a JSON object:
{
    "delete_observation_ids": [1, 2, 3],
    "delete_memory_ids": [4, 5],
    "reasoning": "brief explanation of what was removed and why"
}

If nothing should be deleted, return:
{
    "delete_observation_ids": [],
    "delete_memory_ids": [],
    "reasoning": "all items are worth keeping"
}
