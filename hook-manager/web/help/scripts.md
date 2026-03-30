# Writing Scripts

When a hook fires, your script receives the event payload and can influence Claude Code's behavior through its output and exit code.

## Input: stdin

Your script receives a **JSON object on stdin** containing the event payload. Every payload includes these common fields:

| Field | Type | Description |
|-------|------|-------------|
| `hook_event_name` | string | The event that triggered this hook (e.g. `PreToolUse`) |
| `session_id` | string | Unique identifier for the Claude Code session |
| `cwd` | string | Current working directory of the session |

Each event adds its own fields on top of these. See the **Events** help topic for the full payload shape of every event.

### Example stdin (PreToolUse)

```json
{
    "hook_event_name": "PreToolUse",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "tool_name": "Bash",
    "tool_input": {
        "command": "rm -rf node_modules",
        "description": "Remove node_modules"
    }
}
```

## Environment Variables

Hook Manager injects these environment variables into your script:

| Variable | Description |
|----------|-------------|
| `CLAUDE_SESSION_ID` | Current session identifier |
| `CLAUDE_CWD` | Current working directory |
| `CLAUDE_MD_PATHS` | Colon-separated paths to CLAUDE.md and AGENTS.md files found walking up from cwd |

Additional `CLAUDE_*` variables may be present if Claude Code sends custom HTTP headers.

## Output: stdout

Write **JSON to stdout** to send data back to Claude Code. The most common output fields:

| Field | Effect |
|-------|--------|
| `systemMessage` | Injects a message into Claude's system prompt for the current turn |
| `suppressOutput` | If `true`, suppresses Claude's default output for this event |

### Example stdout

```json
{
    "systemMessage": "Reminder: always run tests before committing."
}
```

If multiple hooks fire for the same event, their JSON outputs are **deep-merged** (last writer wins for conflicting keys, except `systemMessage` which concatenates).

## Output: stderr

Write to **stderr** for debug logging. Stderr output is captured in the Hook Manager logs but is **never sent to Claude Code**. Use it for diagnostics.

## Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| **0** | Success — stdout is forwarded to Claude Code |
| **2** | **Block** — prevents the action Claude was about to take (only on blockable events) |
| **Other** | Error — logged but treated as non-blocking |

### Blocking with Exit Code 2

When your script exits with code 2, Claude Code **will not perform the action**. This only works on blockable events:

> PreToolUse, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TeammateIdle, TaskCompleted, ConfigChange, WorktreeCreate, Elicitation, ElicitationResult

For non-blockable events, exit code 2 is treated like any other error.

When blocking, you should still write a JSON `systemMessage` to stdout explaining **why** the action was blocked — otherwise Claude won't know what happened.

## Timeouts

Each hook has a configurable timeout (default: 10 seconds). If your script doesn't finish in time, it's killed and the result is marked as timed out. Timed-out hooks never block.

## Script Types

### Command

A shell command run via `sh -c "your command here"`. Good for one-liners:

```yaml
hooks:
    PreToolUse:
        - name: warn-rm
          type: command
          command: |
              payload=$(cat)
              cmd=$(echo "$payload" | jq -r '.tool_input.command // ""')
              if echo "$cmd" | grep -q 'rm -rf'; then
                  echo '{"systemMessage":"WARNING: rm -rf detected"}'
                  exit 2
              fi
          matcher: "Bash"
```

### Managed Script

A script file in `~/.ai-hooks/scripts/`. The runtime is auto-detected from the file extension:

| Extension | Runtime |
|-----------|---------|
| `.sh` | bash |
| `.py` | python3 |
| `.js` | node or bun |
| `.ts` | bun or node |
| `.rb` | ruby |
| `.go` | go run |

You can override the runtime mapping in Settings, or set it explicitly per hook.

## Reading stdin in Different Languages

### Bash

```bash
#!/usr/bin/env bash
payload=$(cat)
tool_name=$(echo "$payload" | jq -r '.tool_name')
```

### Python

```python
#!/usr/bin/env python3
import json, sys
payload = json.load(sys.stdin)
tool_name = payload.get("tool_name", "")
```

### Node.js / Bun

```javascript
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString());
const toolName = payload.tool_name;
```

### Go

```go
payload, _ := io.ReadAll(os.Stdin)
var data map[string]any
json.Unmarshal(payload, &data)
```
