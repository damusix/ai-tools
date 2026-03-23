---
name: memory-management
description: This skill should be used when saving memories, searching for past context, remembering decisions, forgetting memories, or managing the memory store. Trigger phrases include "remember this", "save a memory", "what did we decide about", "search memories", "forget this", "list tags", "rescan architecture". Guides effective use of ai-memory MCP tools (save_memory, search_memories, list_tags, delete_memory, rescan_project_architecture) and slash commands (/remember, /forget).
version: 0.1.0
---

# Memory Management


## Available Tools

| Tool / Command       | Purpose                              |
| -------------------- | ------------------------------------ |
| `save_memory`        | Save a memory with category and tags |
| `search_memories`    | Full-text search across memories     |
| `search_observations`| Search atomic facts from turns       |
| `list_memories`      | Browse memories with filters         |
| `list_tags`          | List all tags with usage counts      |
| `list_domains`       | List all domains with usage counts   |
| `delete_memory`      | Delete a memory by ID                |
| `rescan_project_architecture` | Refresh tree + manifest snapshot for session context |
| `/remember`          | Slash command to save a memory       |
| `/forget`            | Slash command to find and delete     |


## When to Save

**SAVE**: Architectural decisions with rationale, non-obvious patterns, user preferences, discovered facts not in code/docs, solutions to tricky problems.

**SKIP**: Transient task details, things obvious from code, failed debugging steps, things findable by grep.


## Categories

Pass as the `category` parameter to `save_memory`:

| Category   | When                                        |
| ---------- | ------------------------------------------- |
| decision   | Choice made between options, with rationale |
| pattern    | Recurring approach established for codebase |
| preference | User style or workflow preference           |
| fact       | Discovered truth about system/environment   |
| solution   | Working fix for a non-obvious problem       |


## Importance

1=trivia, 2=useful, 3=normal (default), 4=important (confusion if forgotten), 5=critical (bugs/hours wasted if forgotten)


## Tagging

Use 2-5 tags per memory. Check existing tags with `list_tags` first — prefer existing vocabulary. Good tags: domain (auth, database), technology (react, postgres), pattern type (architecture, testing), component names (user-service, checkout).


## Searching

FTS5 syntax: `"exact phrase"`, `term*` for prefix, `term1 OR term2`. Try multiple queries if first returns nothing. Check `list_tags` to discover what exists.


## References

For detailed FTS5 query syntax and search strategies, see `references/search-patterns.md`.


## Noise Control

- Search before saving to avoid duplicates
- 0-3 saves per session is normal. More is not better.
- Not every decision warrants importance 4 or 5
