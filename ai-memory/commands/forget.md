---
description: Search for and delete memories
argument-hint: [search term]
---

Find and delete memories from the persistent store.

If a search term was provided, call search_memories with that query.
If no search term, call list_memories for the current project.

Present results in a numbered list showing: ID, category, importance, content, tags.
Ask which ones to delete (user can specify IDs or say "all").
Confirm before each deletion. Call delete_memory for confirmed IDs.
Report what was deleted.

For advanced search syntax and strategies, invoke the **memory-management** skill.
