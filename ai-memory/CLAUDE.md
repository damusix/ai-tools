# CLAUDE.md


## Documentation

Read these before making changes:

- `README.md` — What ai-memory does, user-facing features, configuration
- `docs/lifecycle.md` — Full session lifecycle walkthrough, how data flows end-to-end
- `docs/data-model.md` — Database schema, every table/column, indexes, FTS, migrations, staleness policies


## Project Layout

```
src/
  server.ts       — Entry point: starts Hono server, MCP server, worker, PID file
  app.ts          — HTTP routes (health, enqueue, context, CRUD APIs, SSE, dashboard)
  config.ts       — YAML config loader with Zod validation (~/.ai-memory/config.yaml)
  db.ts           — SQLite schema, migrations, all query functions
  tools.ts        — MCP tool definitions (save_memory, search_memories, etc.)
  worker.ts       — Background worker: extraction, synthesis, cleanup, staleness
  context.ts      — Builds the memory context injected at session start
  logger.ts       — Structured logging with section-colored output
  sse.ts          — Server-sent events channel for real-time dashboard updates
  prompts/        — LLM prompt templates (extract, synthesize, cleanup, backfill)
  ui/             — SolidJS + Tailwind dashboard source
hooks/
  hooks.json      — Hook config (SessionStart, Stop)
  scripts/        — Shell scripts that hooks execute
commands/         — Slash commands (/remember, /forget)
skills/           — Skills (memory-management)
test/             — Vitest test files
docs/             — Technical documentation
  plans/          — Design docs and implementation plans (historical)
```


## Commands

```
pnpm build              # Build server (tsup) + UI (vite)
pnpm dev                # Watch mode, server only
pnpm dev:ui             # Vite dev server for dashboard
pnpm vitest run test/   # Run tests
pnpm start              # Start the server
```


## Development Workflow

**Adding a new MCP tool:** Define it in `src/tools.ts` using `server.registerTool()`. Add any backing query functions to `src/db.ts`. The MCP server is created via `@modelcontextprotocol/sdk`.

**Adding a new API route:** Add it in `src/app.ts`. The app is a Hono instance. If the route mutates data, call `broadcast()` from `src/sse.ts` so the dashboard updates in real-time.

**Changing the database schema:** Add an idempotent migration at the end of `initSchema()` in `src/db.ts`. Use `PRAGMA table_info` to check if the column exists before running `ALTER TABLE`. See the `domain` and `skipped_count` migrations as examples.

**Changing LLM behavior:** Edit the prompt templates in `src/prompts/`. These are markdown files with `{{VARIABLE}}` placeholders that get substituted at runtime by `loadPrompt()` in `src/worker.ts`.

**Changing context injection:** Edit `src/context.ts`. The `buildStartupContext()` function controls what Claude sees at session start. Token budget is ~1,000 tokens for memories, ~200 for tags.

**Adding a hook:** Add the event to `hooks/hooks.json` and create a shell script in `hooks/scripts/`. Available events: `SessionStart`, `Stop`.

**Adding a slash command:** Create a markdown file in `commands/` with YAML frontmatter (`description`, `argument-hint`).

**Dashboard UI changes:** The UI is SolidJS in `src/ui/`, built with Vite + Tailwind. Run `pnpm dev:ui` for hot reload.

**Changing configuration defaults:** Edit the Zod schema in `src/config.ts`. All fields use `.default()` so the config file is optional. Use `getConfig()` to read values at runtime. The shell scripts (`hooks/scripts/`) parse port from YAML via grep — keep the `server.port` field name stable.

**MCP port sync:** The startup hook (`hooks/scripts/startup.sh`) rewrites `.mcp.json` in the plugin root and Claude's plugin cache (`~/.claude/plugins/cache/*/ai-memory/`) on every session start with the current port from YAML config. This keeps MCP tool connections in sync when the port changes. The `.mcp.json` format is `{"ai-memory":{"command":"npx","args":["-y","mcp-remote","http://localhost:PORT/mcp"]}}`.


## Conventions

- Package manager: `pnpm`
- Do NOT use `timeout` — use `gtimeout`
- No AI bylines in commits
- Tests go in `test/` directory
- LLM calls use Claude Haiku via `@anthropic-ai/claude-agent-sdk`
