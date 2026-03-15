# ai-memory

A persistent memory system for Claude Code. It extracts observations from your coding sessions, synthesizes them into structured memories, and injects relevant context at the start of each new session.

## Memories

Structured knowledge extracted from your sessions. Each has a **category** (decision, pattern, preference, fact, solution), a **domain** (frontend, backend, api, etc.), an **importance** rating (1–5), and tags. Higher importance memories are prioritized when context space is limited.

## Observations

Raw insights extracted before synthesis. **Pending** observations haven't been processed yet. **Synthesized** ones have been incorporated into memories. Observations skipped too many times are cleaned up automatically.

## Projects

Memories are organized by project directory. **Global** memories apply across all projects. Select a project to filter, or view all projects at once.

## Domains

Domains categorize memories by area — frontend, backend, api, data, security, testing, etc. Assigned automatically during synthesis.

## Actions

- **Settings** — Configure worker, context, server, and API parameters. Manage domains and categories (add, edit, delete, AI generate). Restore built-in defaults for any tab.
- **Logs** — Server activity log: extraction, synthesis, cleanup, errors
- **Clean up** — Removes stale observations (14+ days), skipped observations, and duplicate memories
- **Merge projects** — Merges memories and observations from one or more projects into another (useful when renaming, moving, or consolidating project folders)
- **Restart** — Restarts the ai-memory server process
