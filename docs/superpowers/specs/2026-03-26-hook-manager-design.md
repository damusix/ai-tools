# Hook Manager — Design Spec

A Claude Code plugin that provides a universal hook orchestrator for end users. Users define hooks in a YAML config file and optionally manage them through a web UI — no plugin authoring knowledge required.


## Problem

Writing Claude Code hooks today requires creating a plugin with `hooks.json`, shell scripts, and understanding the plugin directory structure. End users who just want to run a script when Claude edits a file or executes a command have no lightweight path to do so.


## Solution

A single Claude Code plugin that:

1. Registers itself as the handler for all 24 hook events
2. Delegates to user-defined scripts configured in `~/.ai-hooks/config.yaml`
3. Provides a web UI (HTMX + Go templates) for managing hooks, editing scripts, and viewing logs


## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Claude Code                        │
│  (fires hook events with JSON body)                  │
└──────────────┬──────────────────────────────────────┘
               │
               ├─── SessionStart ──► command hook (start.sh)
               │                      boots Go server
               │
               ├─── All other events ──► HTTP POST to Go server
               │
               ▼
┌─────────────────────────────────────────────────────┐
│              Go Server (long-running)                 │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Hook API  │  │ Enricher  │  │ Script Executor  │  │
│  │ /hook/:ev │  │ (adds ctx)│  │ (fan-out, merge) │  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
│                                                      │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │ HTMX UI Server   │  │ YAML Config Manager     │  │
│  │ (templates + API) │  │(~/.ai-hooks/config.yaml)│  │
│  └──────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│                   User Scripts                        │
│  Any language. Receive JSON stdin + env vars.         │
│  Return JSON/NDJSON/plain text to stdout.             │
│  Logs to stderr.                                      │
└─────────────────────────────────────────────────────┘
```


## Technology Choices

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Server runtime | Go | Single binary, no runtime deps, user wants to experiment with Go APIs |
| UI framework | HTMX + Go `html/template` | No JS build pipeline, server-rendered, fits Go naturally |
| Config format | YAML | Human-editable, supports comments, familiar |
| JS libraries | CDN (Monaco Editor, PrismJS, Tailwind CSS) | Only HTMX is embedded in binary |
| Distribution | Pre-built binaries per platform | Same pattern as auto-approve-compound-bash plugin |
| HTTP framework | `net/http` stdlib | Minimal deps, HTMX headers set manually |


## Plugin Structure

```
hook-manager/
├── .claude-plugin/
│   └── plugin.json
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── config/           # YAML config loading, validation, hot reload
│   ├── executor/         # Script execution, timeout, output capture
│   ├── enricher/         # Context enrichment (claude.md paths, etc.)
│   ├── hooks/            # Hook API handlers (/hook/{event})
│   ├── aggregator/       # JSON merge + text concatenation
│   ├── logger/           # NDJSON log writer + rotation
│   └── ui/               # HTMX handlers + template rendering
├── web/
│   └── templates/        # Go HTML templates (embedded via go:embed)
├── hooks/
│   ├── hooks.json        # Claude Code hook registration
│   └── scripts/
│       └── start.sh      # SessionStart: boots server, forwards event
├── bin/                  # Pre-built binaries (darwin/linux, amd64/arm64)
├── scripts/
│   └── build.sh
├── go.mod
├── go.sum
└── CHANGELOG.md
```


## State Directory

All user state lives in `~/.ai-hooks/`:

```
~/.ai-hooks/
├── config.yaml    # Hook definitions (user-managed or UI-managed)
├── scripts/       # Default home for UI-created/managed scripts
├── hooks.log      # NDJSON execution logs
└── .port          # Runtime: current server port (read by start.sh)
```


## YAML Config Schema

```yaml
server:
  port: 47821          # Fixed default port; fail clearly if taken
  log_level: info      # debug, info, warn, error

hooks:
  PreToolUse:
    - name: block-secrets
      type: command
      command: grep-secrets --strict
      matcher: "Write|Edit"
      enabled: true
      timeout: 5

    - name: lint-python
      type: managed
      file: lint.py
      runtime: python3
      matcher: "Bash"
      enabled: true
      timeout: 10

  PostToolUse:
    - name: format-on-write
      type: managed
      file: format.js
      runtime: bun
      matcher: "Write"
      enabled: false
      timeout: 15

  Stop:
    - name: session-summary
      type: command
      command: python3 ~/tools/summarize.py
      enabled: true
      timeout: 30
```

### Hook Types

**Managed** — script lives in `~/.ai-hooks/scripts/`, editable via the UI:
- `file`: filename relative to `~/.ai-hooks/scripts/`
- `runtime`: how to execute it (e.g., `python3`, `bun`, `node`, `deno`, `bash`)
- Server constructs: `{runtime} {~/.ai-hooks/scripts/file}`

**Command** — arbitrary shell command:
- `command`: raw command string executed via `sh -c`
- Can point anywhere on the filesystem

### Common Fields

- `name`: unique identifier for the hook within its event group (the composite key is `{event}/{name}`)
- `matcher`: regex string (optional, omit to match all). Matched against the relevant field per event (tool_name, source, agent_type, etc.)
- `enabled`: boolean toggle
- `timeout`: seconds before the script is killed


## Supported Hook Events

All 24 Claude Code hook events:

| Event | Blockable | Matcher Field |
|-------|-----------|---------------|
| `SessionStart` | No | source (startup, resume, clear, compact) |
| `SessionEnd` | No | reason |
| `UserPromptSubmit` | Yes | (none) |
| `PreToolUse` | Yes | tool_name |
| `PostToolUse` | No | tool_name |
| `PostToolUseFailure` | No | tool_name |
| `PermissionRequest` | Yes | tool_name |
| `Stop` | Yes | (none) |
| `StopFailure` | No | error type |
| `SubagentStart` | No | agent_type |
| `SubagentStop` | Yes | agent_type |
| `Notification` | No | notification_type |
| `TeammateIdle` | Yes | (none) |
| `TaskCompleted` | Yes | (none) |
| `InstructionsLoaded` | No | load_reason |
| `ConfigChange` | Yes | config source |
| `CwdChanged` | No | (none) |
| `FileChanged` | No | filename basename |
| `WorktreeCreate` | Yes | (none) |
| `WorktreeRemove` | No | (none) |
| `PreCompact` | No | manual/auto |
| `PostCompact` | No | manual/auto |
| `Elicitation` | Yes | MCP server name |
| `ElicitationResult` | Yes | MCP server name |


## Server Lifecycle

### Startup

1. `SessionStart` command hook runs `start.sh`
2. `start.sh` starts the Go binary as a background process
3. Go binary reads `~/.ai-hooks/config.yaml`
4. Starts listening on the configured port (default `47821`), writes port to `~/.ai-hooks/.port`
5. `start.sh` waits for health check (`GET /health`)
6. `start.sh` forwards the SessionStart event to the server via curl and returns the response

**Why a fixed port:** HTTP hook URLs in `hooks.json` are loaded by Claude Code at plugin registration time, before `SessionStart` fires. Dynamic port rewriting would create a race condition. A fixed port is hardcoded in both `hooks.json` and `config.yaml`. If the port is taken, the server fails with a clear error message.

**SessionStart special case:** This is the only event handled as a `command` hook (to boot the server). The bash script forwards the event to the server after startup so user scripts registered for SessionStart still execute through the normal aggregation pipeline. All other events are `http` hooks — Claude Code POSTs directly to the server.

**`CLAUDE_ENV_FILE` caveat:** This env var is not reliably provided to plugin SessionStart hooks. Do not use it.

### During Session

All hook events arrive as HTTP POSTs directly from Claude Code to `http://localhost:{port}/hook/{event}`.

### Shutdown

`SessionEnd` HTTP hook triggers graceful shutdown: finish in-flight requests, remove `.port` file, exit.


## Hook Execution Flow

1. Receive JSON body from Claude Code via `POST /hook/{event}`
2. **Enrich** — add plugin env vars from request headers, resolve hierarchical claude.md paths from `cwd`
3. **Match** — filter hooks in config by event name, then apply matcher regex against the relevant input field
4. **Execute** — run matching hooks concurrently (fan-out), each with its own timeout
5. **Aggregate** results:
    - JSON outputs: deep-merge all response objects (last writer wins for conflicting keys)
    - Plain text outputs: collected as-is
    - `systemMessage` strings: concatenated with `\n———\n` separator
    - If any hook returns exit code 2 (block): aggregated response reflects the block
    - Final response: merged JSON + all plain text concatenated into one body
    - stderr from all hooks: captured and appended to `~/.ai-hooks/hooks.log`
6. Return aggregated response to Claude Code

### Exit Code Semantics (User Script → Go Server)

| Exit Code | Behavior |
|-----------|----------|
| 0 | Success — parse stdout for JSON or plain text |
| 2 | Block — server translates to event-appropriate HTTP response (see below) |
| Other | Non-blocking error — log it, skip this hook's output |
| Timeout | Kill process, treat as non-blocking error, log it |

### Block Response Translation (Go Server → Claude Code)

Since all non-SessionStart events use HTTP hooks, the Go server must translate a user script's exit code 2 into a `2xx` HTTP response with the correct per-event JSON decision fields. Claude Code ignores HTTP status codes for blocking — only the JSON body matters.

When any user script exits 2, the server captures its stderr as the reason and returns:

| Event | Response JSON |
|-------|---------------|
| `PreToolUse` | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"{stderr}"}}` |
| `PermissionRequest` | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"{stderr}"}}}` |
| `UserPromptSubmit` | `{"decision":"block","reason":"{stderr}"}` |
| `Stop`, `SubagentStop` | `{"decision":"block","reason":"{stderr}"}` |
| `TeammateIdle` | `{"continue":false,"stopReason":"{stderr}"}` (teammate receives stderr and retries) |
| `TaskCompleted` | `{"continue":false,"stopReason":"{stderr}"}` (task not marked complete, stderr fed to model) |
| `ConfigChange` | `{"decision":"block","reason":"{stderr}"}` |
| `WorktreeCreate` | Return non-2xx HTTP status (omit `worktreePath` to abort creation) |
| `Elicitation`, `ElicitationResult` | `{"hookSpecificOutput":{"hookEventName":"{event}","action":"decline"}}` |
| Non-blockable events | Exit 2 treated as non-blocking error (logged, skipped) |

The server maintains a mapping of event name → block response template. This is the critical translation layer between the simple exit-code contract user scripts use and the per-event JSON contract Claude Code expects.


## Server API Routes

### Hook Execution

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/hook/{event}` | Execute hooks for an event, return aggregated response |
| GET | `/health` | Health check |

### Config & Hook Management

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/config` | Get current YAML config as JSON |
| PUT | `/api/config` | Update config (raw YAML) |
| GET | `/api/hooks` | List all hook definitions |
| POST | `/api/hooks` | Create a hook |
| PUT | `/api/hooks/{event}/{name}` | Update a hook |
| DELETE | `/api/hooks/{event}/{name}` | Delete a hook |
| POST | `/api/hooks/{event}/{name}/test` | Test-run a hook with sample payload |

### Script Management

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/scripts` | List managed scripts |
| POST | `/api/scripts` | Create a new managed script |
| GET | `/api/scripts/{file}` | Read a managed script file |
| PUT | `/api/scripts/{file}` | Save a managed script file |
| DELETE | `/api/scripts/{file}` | Delete a managed script |

### Logs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/logs` | Query execution logs (filterable) |
| GET | `/api/logs/stream` | SSE endpoint for live log tailing |

### UI

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Dashboard |
| GET | `/hooks` | Hook manager |
| GET | `/hooks/{event}/{name}` | Hook detail/editor |
| GET | `/scripts` | Script browser |
| GET | `/scripts/{file}` | Script editor (Monaco) |
| GET | `/config` | Config editor (Monaco/PrismJS) |
| GET | `/logs` | Log viewer with live tail (SSE) |
| GET | `/test` | Test bench |


## UI Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Overview: active hook counts per event, recent log entries, server status |
| **Hook Manager** | All hooks grouped by event. Enable/disable toggles, reorder, create new |
| **Hook Detail** | Edit hook config (name, matcher, timeout, runtime). Test with sample payload. View execution history |
| **Script Browser** | List managed scripts in `~/.ai-hooks/scripts/`. Create new files |
| **Script Editor** | Monaco editor with syntax highlighting by file extension. Save, run test |
| **Config Editor** | Monaco/PrismJS for raw `config.yaml` with syntax highlighting + validation |
| **Log Viewer** | Filterable by event, hook name, time range, exit code. Live tail via SSE |
| **Test Bench** | Pick event type, craft JSON payload, fire against registered hooks, see results |

### Frontend Libraries (CDN)

- **HTMX** — embedded in Go binary
- **Monaco Editor** — `<script src="...">` from CDN
- **PrismJS** — `<script src="...">` from CDN
- **Tailwind CSS** — `<script src="...">` from CDN


## Plugin Registration

### hooks.json

SessionStart registered as `command` hook (to boot the server). All other events registered as `http` hooks with the fixed port:

```json
{
    "hooks": {
        "SessionStart": [{
            "hooks": [{
                "type": "command",
                "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/start.sh\"",
                "timeout": 10
            }]
        }],
        "PreToolUse": [{
            "matcher": ".*",
            "hooks": [{
                "type": "http",
                "url": "http://localhost:47821/hook/PreToolUse",
                "timeout": 10
            }]
        }],
        "PostToolUse": [{
            "matcher": ".*",
            "hooks": [{
                "type": "http",
                "url": "http://localhost:47821/hook/PostToolUse",
                "timeout": 10
            }]
        }]
    }
}
```

All 23 non-SessionStart events follow the same `http` pattern. The port `47821` matches the default in `config.yaml`. If the user changes the port in config, they must also update `hooks.json` (the UI can automate this).

### marketplace.json Entry

```json
{
    "name": "hook-manager",
    "version": "0.1.0",
    "source": "./hook-manager",
    "description": "Universal hook orchestrator with web UI",
    "author": { "name": "Danilo Alonso" },
    "keywords": ["hooks", "orchestrator", "ui", "management"]
}
```

### plugin.json

```json
{
    "name": "hook-manager",
    "version": "0.1.0",
    "description": "Universal hook orchestrator with web UI — manage Claude Code hooks without writing plugins",
    "author": { "name": "Danilo Alonso" }
}
```


## Error Handling

### User Script Failures

| Condition | Behavior |
|-----------|----------|
| Exit 0 | Success — include output in aggregation |
| Exit 2 | Block — propagate block response to Claude Code |
| Other exit | Non-blocking error — log, skip output |
| Timeout | Kill process, non-blocking error, log |
| Crash/panic | Capture stderr, non-blocking error, log |

### Server Errors

| Condition | Behavior |
|-----------|----------|
| Config parse failure on startup | Exit with error to stderr |
| Config parse failure on hot reload | Log warning, keep previous config |
| Port unavailable | Fail with clear error message to stderr |

### Logging

NDJSON format at `~/.ai-hooks/hooks.log`:

```json
{"timestamp":"2026-03-26T10:15:32Z","event":"PreToolUse","hook":"block-secrets","matcher":"Write|Edit","exit_code":0,"duration_ms":45,"stdout_preview":"{...}","stderr":""}
```

Log rotation at 5MB, keep last 3 rotations.


## Testing Strategy

### Go Unit Tests

- **Config**: loading, validation, hot reload, malformed YAML
- **Executor**: script execution, timeout enforcement, exit code mapping, output capture
- **Aggregator**: JSON merging, text concatenation, mixed JSON+text responses
- **Hook handlers**: routing by event, matcher filtering, enrichment

### Integration Tests

- Start server, send hook payloads via HTTP, verify aggregated responses
- Managed script execution end-to-end
- Command execution end-to-end
- NDJSON log output verification, rotation

### Manual Testing

The Test Bench UI page (`/test`) serves as the primary manual testing tool for end users.


## Distribution

Pre-built binaries in `bin/` for:
- `darwin-amd64`
- `darwin-arm64`
- `linux-amd64`
- `linux-arm64`

Cross-compilation via `scripts/build.sh`. Same pattern as the `auto-approve-compound-bash` plugin.
