# Session Lifecycle


This document walks through what ai-memory does from the moment you start a Claude Code session to the moment your memories appear in the next one.


## 1. Session Starts


When you open a Claude Code session, the `SessionStart` hook fires. This hook runs a shell script (`hooks/scripts/startup.sh`) that does two things:

**Ensures the server is running.** It pings `GET /health` on `localhost:24636`. If nothing responds, it starts the ai-memory server as a background process. The server is a Hono app running on `@hono/node-server` that hosts the HTTP API, the dashboard UI, and the background worker. It writes its PID to `~/.ai-memory/ai-memory.pid` and logs to `~/.ai-memory/server.log`. The startup script waits up to 5 seconds for the server to become healthy before continuing.

**Fetches your memory context.** The script sends `POST /context` with your current project path. The server responds with a system message containing your memories, formatted for injection into the conversation.


## 2. Context Gets Injected


The context builder (`src/context.ts`) assembles a memory summary within a ~1,000 token budget (~4,000 characters). It works in two phases:

**Phase 1 — Diversity pass.** Every domain that has memories gets its single most important memory included. This guarantees that if you have frontend memories and backend memories and testing memories, each domain is represented even if one domain has much higher-importance items than the others.

**Phase 2 — Importance fill.** The remaining token budget is filled by pulling memories in order of importance across all domains, regardless of which domain they belong to.

The result is a structured block that looks like this:

```
<memory-context project="/Users/you/projects/my-app">

## Memories (8 of 14)

**Legend:**
> H3 headings = domain (count shown of total)
> Line format: `- [category] (importance) content tags: t1,t2`
> Importance: 1=trivia, 2=useful, 3=normal, 4=important, 5=critical

### Backend (2 of 6)
- [decision] (5) Hono framework chosen over Express for edge compatibility tags: hono,api
- [fact] (4) Database connection pool max_overflow set to 20 tags: postgres,performance

### Frontend (3)
- [pattern] (4) All forms use controlled components with Zod validation tags: forms,zod
- [preference] (3) Prefer CSS modules over Tailwind for component styles tags: css
- [solution] (3) Fixed hydration mismatch by wrapping client-only code in useEffect tags: ssr,react

### Testing (2 of 4)
- [pattern] (4) Integration tests use real SQLite DB, not mocks tags: testing,database
- [fact] (3) Vitest config requires explicit test directory include tags: vitest

## Tags (name followed by memory count)
react(5), postgres(3), testing(3), api(2), css(2), forms(1)

> **Tip:** Only 8 of 14 memories are shown above. If your task is heavy on a
> specific domain (Backend, Frontend, Testing, ...), use the `search_memories`
> MCP tool to retrieve deeper context for that domain.

## ai-memory Dashboard
Manage memories and observations at http://localhost:24636

</memory-context>
```

This block becomes a system message in your conversation. Claude sees it before your first prompt and can reference any of these memories while working with you.

The legend at the top tells Claude how to interpret the format. The tip at the bottom encourages Claude to actively search for more memories when the task aligns heavily with a specific domain — because only a subset fits within the token budget.


## 3. You Work


During your session, Claude has your project context from previous sessions. You can also interact with memories directly:

**Slash commands.** `/remember` saves a new memory with your chosen category, tags, and importance. `/forget` searches for and deletes memories you no longer want.

**MCP tools.** Claude can call `save_memory`, `search_memories`, `list_memories`, `delete_memory`, `list_tags`, `list_domains`, and `list_projects` at any time during the conversation. These are available automatically — Claude sees them as tool definitions in the MCP server.

**Dashboard.** The web UI at `http://localhost:24636` lets you browse memories and observations, delete items, trigger manual cleanup, and view server logs. It updates in real-time via server-sent events.

Most of the time, you don't need to do anything. The automatic extraction and synthesis pipeline handles learning from your conversations. The manual tools exist for when you want to explicitly tell ai-memory something important, or clean up something it got wrong.


## 4. Session Ends


When you close your Claude Code session, the `Stop` hook fires. It runs `hooks/scripts/stop.sh`, which reads the conversation data from stdin and sends it to the server via `POST /enqueue`. This is non-blocking — it fires and forgets so your session closes instantly.

The server writes the payload to the `observation_queue` table with status `pending`. At this point, nothing has been extracted yet. The conversation data is just sitting in a queue waiting for the worker.


## 5. Observations Get Extracted


The background worker polls every 5 seconds. When it finds a pending item in the `observation_queue`, it:

1. Dequeues the item (sets status to `processing`).
2. Sends the conversation payload (first 8,000 characters) to Claude Haiku via the Agent SDK.
3. The extraction prompt (`src/prompts/extract-observations.md`) asks the LLM to pull out atomic facts — single pieces of information worth remembering. Each observation gets a content string and a source summary.
4. The LLM returns a JSON array of observations.
5. Each observation is inserted into the `observations` table with `processed = 0`.
6. The queue item is marked `done`.

After extraction, the worker checks how many unprocessed observations exist for this project. If the count reaches 10 or more, it enqueues a memory synthesis job.

Observations are intentionally low-level and numerous. They're raw material, not finished product. A single session might produce 5-15 observations depending on how substantive the conversation was.


## 6. Memories Get Synthesized


When the `memory_queue` has a pending job, the worker:

1. Dequeues the synthesis job.
2. Fetches all unprocessed observations for the project.
3. Fetches the top 20 existing memories (by importance) for context — so the LLM knows what's already been captured.
4. Sends everything to Claude Haiku with the synthesis prompt (`src/prompts/synthesize-memories.md`).

The synthesis prompt instructs the LLM to:

- **Merge** similar observations into single memories.
- **Update** existing memories when new observations refine or extend them.
- **Skip** observations that are already captured.
- **Assign** exactly one domain to each memory from the predefined list.
- **Categorize** each memory as decision, pattern, preference, fact, or solution.
- **Rate** importance on the 1-5 scale.

The LLM returns a JSON object with `creates` (new memories) and `updates` (modifications to existing memories). The worker executes these against the database, then marks the contributing observations as `processed = 1`.

**Strike tracking.** After synthesis, the worker compares which observations were fed to the LLM versus which ones actually appeared in creates or updates. Observations that were available but not used get their `skipped_count` incremented. If an observation reaches 3 skips — meaning it has been fed to synthesis three separate times and ignored each time — it is auto-deleted. This prevents dead-weight observations from consuming prompt tokens indefinitely.


## 7. Cleanup Runs


Immediately after synthesis, the worker runs an LLM-based cleanup pass (`src/prompts/cleanup.md`). This reviews:

- The 200 most recent observations.
- The 100 top memories (by importance).

The cleanup prompt tells Claude Haiku to identify and delete:

- **Junk:** Git operations, commit hashes, build output noise.
- **Stale:** Superseded information that's no longer accurate.
- **Redundant:** Duplicates or near-duplicates.
- **Vague:** Observations too generic to be useful.
- **Trivial:** Low-value items not worth keeping.

The LLM returns lists of observation IDs and memory IDs to delete, along with reasoning.

**TTL purge.** On every poll cycle (not just after synthesis), the worker also runs a simple TTL check: any observation with `processed = 1` and `created_at` older than 14 days is deleted. These observations have already been absorbed into memories — their only remaining value was as an audit trail, and 14 days is enough for that.


## 8. Next Session Starts


The cycle repeats. When you start your next Claude Code session, the `SessionStart` hook fires again, fetches the now-updated memory context, and injects it. Claude sees the memories that were synthesized from your previous sessions and can build on that knowledge immediately.

Over time, the memory store evolves: new memories appear, existing ones get refined with additional context, stale ones get cleaned up, and the importance ratings settle to reflect what actually matters for your project.


## Timeline Summary

```
Session N                              Between sessions                Session N+1
─────────                              ────────────────                ───────────

SessionStart hook                                                     SessionStart hook
  ├─ Start server (if needed)                                           ├─ Server already running
  └─ Inject memory context                                              └─ Inject UPDATED context
        │                                                                      │
     You work                                                              You work
     (Claude has context)                                                  (Claude has MORE context)
        │
   Stop hook
     └─ Enqueue conversation
                                       Worker picks up queue
                                         ├─ Extract observations
                                         ├─ Threshold reached?
                                         │    └─ Yes → Synthesize memories
                                         │              ├─ Create/update memories
                                         │              ├─ Track skipped observations
                                         │              └─ Run LLM cleanup
                                         └─ TTL purge (every cycle)
```
