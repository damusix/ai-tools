You classify a software repository using ONLY the JSON below (directory tree text + manifest file paths and raw contents). Return structured stack hints.

FACTS JSON:
{{FACTS_JSON}}

Return ONLY a JSON array (no markdown fence) of objects:
`{ "kind": "short-label", "evidence": ["path or quote"] }`

Rules:
- Use short `kind` values: e.g. nextjs, rails, laravel, expo, tauri, solidjs, vue, svelte, kotlin, swift, java-gradle.
- Every item MUST cite evidence from the provided paths or substrings of manifest content.
- If uncertain, omit the item. Do not invent files or dependencies not reflected in the input.
- Cap: at most 20 items.
