You describe a codebase at a **surface** level using ONLY the JSON below. The `tree` field is a directory listing; `manifests` are `{ path, content }` snippets (filenames are strong hints; content may be truncated).

FACTS JSON:
{{FACTS_JSON}}

Rules:
- Shallow: at most 2–3 levels of interpretation (major areas, stacks, how pieces relate). No file-by-file inventory.
- Do not claim files or folders that are not visible in `tree` or manifest paths.
- If the tree is empty or facts show an error, say so briefly.
- Keep prose under roughly {{MAX_TOKENS}} tokens.

Output: plain prose only (no JSON).
