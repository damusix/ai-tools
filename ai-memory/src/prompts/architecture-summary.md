Write a **short** project architecture blurb for injection into an AI assistant's session context.

FACTS JSON (ground truth):
{{FACTS_JSON}}

LONGER INTERPRETATION (may repeat facts; prefer facts when they conflict):
{{ARCHITECTURE_FULL}}

Rules:
- Preserve a coarse **tree feel** (top-level / major folders) in a few lines.
- Mention likely stacks/tools only when supported by facts.
- Target at most {{MAX_TOKENS}} tokens. Plain prose only, no JSON.
