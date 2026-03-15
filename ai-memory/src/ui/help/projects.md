ai-memory organizes memories by project. Each project corresponds to a directory where you've used Claude Code. When you select a project, you see memories and observations specific to that project, plus any global memories (marked as "global"). Global memories apply across all your projects — things like your general coding preferences or tool choices.

## Merging Projects

If you rename or move a project folder, its memories become orphaned under the old path. Use **Merge projects** in the menu to move all memories and observations to the new path.

- **New path** — Renames the project in place. All memories and observations stay linked.
- **Existing project** — Merges memories and observations into another project, then removes the source project(s).

You can also merge via the `transfer_project` MCP tool during a Claude session, or via `POST /api/projects/transfer` with `{ "from": "old/path", "to": "new/path" }`.
