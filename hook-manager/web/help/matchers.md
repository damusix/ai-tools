# Matchers

A matcher is an optional **regex filter** that controls when a hook fires. Without a matcher, the hook fires for every occurrence of its event. With a matcher, it only fires when the regex matches a specific field in the payload.

## How It Works

1. An event arrives (e.g. `PreToolUse`)
2. Hook Manager extracts the **matcher field** from the JSON payload
3. Your regex is tested against that field value
4. If it matches (or if no matcher is set), the hook fires

## Matcher Fields by Event

Each event type matches against a different payload field:

| Event | Matches Against | Example Values |
|-------|----------------|----------------|
| PreToolUse | `tool_name` | `Bash`, `Write`, `Read`, `Edit`, `Grep`, `Glob` |
| PostToolUse | `tool_name` | Same as above |
| PostToolUseFailure | `tool_name` | Same as above |
| PermissionRequest | `tool_name` | Same as above |
| SessionStart | `source` | `startup` |
| SessionEnd | `reason` | `clear` |
| StopFailure | `error` | `rate_limit`, `context_limit_exceeded` |
| SubagentStart | `agent_type` | `Explore`, `Plan` |
| SubagentStop | `agent_type` | Same as above |
| Notification | `notification_type` | `permission_prompt`, `info` |
| InstructionsLoaded | `load_reason` | `session_start`, `user` |
| FileChanged | `file_path` | Full file path |
| ConfigChange | `source` | `user_settings` |
| Elicitation | `mcp_server` | MCP server name |
| ElicitationResult | `mcp_server` | Same as above |

Events **without** a matcher field (always match if no regex set):
`UserPromptSubmit`, `Stop`, `TeammateIdle`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`, `PreCompact`, `PostCompact`

## Regex Syntax

Matchers use Go's `regexp` package (RE2 syntax). Common patterns:

| Pattern | Matches |
|---------|---------|
| `Bash` | Events where the field contains "Bash" |
| `^Bash$` | Exactly "Bash" (anchored) |
| `Bash\|Write` | "Bash" or "Write" |
| `^(Bash\|Write\|Edit)$` | Exactly one of these three |
| `.*` | Everything (same as no matcher) |
| `\.env` | File paths containing ".env" |
| `^(?!Bash)` | Anything except "Bash" (negative lookahead) |

## Examples

**Only fire for Bash commands:**
```
Bash
```

**Fire for file-writing tools:**
```
^(Write|Edit|Bash)$
```

**Fire for all tool events except Read:**
```
^(?!Read$)
```

**Match .env file changes:**
```
\.env
```

## Tips

- Leave the matcher **empty** to match all occurrences of the event
- Use `^` and `$` anchors for exact matches
- Test your regex in the Test Bench before deploying
- Matchers are case-sensitive
