You are assigning domains to existing memories. For each memory, determine which domain(s) it belongs to. If a memory spans multiple domains, split it into separate memories scoped to each domain.

DOMAINS:
{{DOMAINS}}

MEMORIES TO ASSIGN:
{{MEMORIES}}

Return ONLY a JSON array. Each entry is one memory assignment:
[
    {
        "original_id": 5,
        "assignments": [
            {"domain": "frontend", "content": "content scoped to frontend concerns"},
            {"domain": "styling", "content": "content scoped to styling concerns"}
        ]
    }
]

Rules:
- If a memory fits one domain, return one assignment with the original content unchanged
- If a memory spans multiple domains, split the content so each assignment is scoped to its domain
- Every assignment must use a domain from the list above
- Preserve the meaning — don't lose information when splitting
- When in doubt, use "general"
