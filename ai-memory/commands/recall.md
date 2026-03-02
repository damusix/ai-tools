---
description: Search and browse memories interactively
argument-hint: "[search query]"
---

Search and browse the persistent memory store.

If a search query was provided, call `search_memories` with that query.
If no query was provided, call `list_memories` for the current project (limit 20).

Present results in a numbered list showing: ID, category, importance, content, tags, domain.

Offer follow-up actions:
- Refine the search with different terms
- View full details of a specific memory
- Delete a memory by ID

For advanced search syntax and strategies, invoke the **memory-management** skill.
