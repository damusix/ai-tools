You are analyzing a software project based on its stored memories. Generate a brief description and choose an appropriate Font Awesome icon.

PROJECT PATH: {{PROJECT_PATH}}

MEMORIES (sample):
{{MEMORIES}}

Return ONLY a JSON object:
{
    "description": "One sentence describing what this project is about",
    "icon": "fa-icon-name"
}

Rules:
- Description should be 1 sentence, max 100 characters
- Icon must be a Font Awesome solid icon class (e.g. "fa-rocket", "fa-code", "fa-store")
- Choose an icon that represents the project's primary focus
- Common choices: fa-code (generic coding), fa-globe (web app), fa-mobile (mobile), fa-server (backend), fa-robot (AI/ML), fa-store (e-commerce), fa-graduation-cap (education), fa-gamepad (gaming)
