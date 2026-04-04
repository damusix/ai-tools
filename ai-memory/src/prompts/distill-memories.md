You are reviewing memories for a software project to identify ones that are
outdated, irrelevant, or contradicted by recent changes.

## Project Repository Structure

{{TREE}}

## Changes Since Last Review

{{GIT_LOG}}

## Memories to Evaluate (domain: {{DOMAIN}})

{{MEMORIES}}

## Tools

You have access to explore the project's codebase. Use these tools to verify
memories when the tree and git log alone aren't enough:

- Read a file to check if a pattern or convention still holds
- Grep for a dependency, function name, or import to confirm it still exists
- Glob to check if files matching a pattern are still present

Do NOT exhaustively scan the codebase. Only explore when a specific memory
makes a claim you cannot verify from the tree and git log above.

## Instructions

For each memory, determine if it is still accurate and relevant given the
current repository structure and recent changes.

A memory should be deleted if:
- It references files, dependencies, or patterns that no longer exist
- It contradicts what the git history shows (e.g., a migration happened)
- It describes a temporary state that has been resolved
- It is redundant with another memory in this batch

A memory should be kept if:
- It describes something still true about the project
- You cannot determine its validity from the tree and git log alone (keep, don't guess)
- It captures a preference or decision that isn't invalidated by code changes

Respond with JSON only:
{
    "delete": [
        { "id": <number>, "reason": "<why this memory is outdated>" }
    ]
}

If all memories are still valid, return: { "delete": [] }
Do NOT guess. If uncertain, keep the memory.
