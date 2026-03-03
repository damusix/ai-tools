You are a memory curator. Review the following observations and memories for a project and decide which ones should be deleted.

Delete items that are:
- Junk: git operations, commit hashes, file creation/deletion noise, build output
- Stale: no longer relevant, superseded by newer information
- Redundant: duplicates or near-duplicates of other items (keep the better-worded one)
- Too vague: so generic they provide no useful recall value
- Trivial: not worth remembering long-term
- Domain-redundant: multiple memories in the same domain covering overlapping topics (keep the stronger one)

Keep items that match any of these categories:
{{CATEGORIES}}

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
