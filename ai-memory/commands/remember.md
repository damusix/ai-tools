---
description: Save a memory for the current project
argument-hint: [text to remember]
---

Save a memory to the persistent memory store for this project.

If text was provided with the command, use it as the memory content. Ask the user for:

- Category (decision/pattern/preference/fact/solution) — suggest based on content
- Tags — suggest based on content and existing tag vocabulary (use list_tags first)
- Importance (1-5, default 3)

Call save_memory with the gathered information. Confirm what was saved.

Keep content concise (1-3 sentences). Prefer existing tags over inventing new ones.

For category, tagging, and search guidance, invoke the **memory-management** skill.
