# Blocking Actions

Your scripts can **prevent Claude Code from performing an action** by exiting with code 2. This is one of the most powerful features of Hook Manager.

## How It Works

1. Claude Code is about to do something (e.g. run a Bash command)
2. Your PreToolUse hook receives the payload
3. Your script decides this should be blocked
4. Script writes a reason to stdout and exits with code **2**
5. Claude Code **does not execute** the tool and sees your message

## Exit Code 2

Exit code 2 is the **only** way to block. Any other non-zero exit code is treated as a script error and does not block.

```bash
#!/usr/bin/env bash
# Block dangerous commands
payload=$(cat)
cmd=$(echo "$payload" | jq -r '.tool_input.command // ""')

if echo "$cmd" | grep -qE 'rm\s+-rf\s+/'; then
    echo '{"systemMessage":"BLOCKED: Cannot rm -rf root directory"}'
    exit 2
fi
```

## Blockable Events

Not all events support blocking. Only these events can be blocked:

| Event | What Gets Blocked |
|-------|-------------------|
| **PreToolUse** | The tool execution (Bash, Write, Read, etc.) |
| **PermissionRequest** | The permission dialog — can auto-deny |
| **UserPromptSubmit** | The user's prompt from being processed |
| **Stop** | The agent from stopping — forces it to continue |
| **SubagentStop** | The subagent from stopping |
| **TeammateIdle** | The teammate from going idle |
| **TaskCompleted** | The task from being marked complete |
| **ConfigChange** | The config change from taking effect |
| **WorktreeCreate** | The worktree from being created |
| **Elicitation** | The MCP elicitation from proceeding |
| **ElicitationResult** | The elicitation result from being processed |

**Non-blockable events** (exit code 2 is ignored):
PostToolUse, PostToolUseFailure, StopFailure, SubagentStart, SessionStart, SessionEnd, Notification, InstructionsLoaded, FileChanged, CwdChanged, PreCompact, PostCompact, WorktreeRemove

## Best Practices

- **Always include a systemMessage** when blocking — Claude needs to know why
- **Be specific** in your block message so Claude can adjust its approach
- **Use matchers** to narrow which invocations your blocking hook runs on (e.g. only Bash, not Read)
- **Set short timeouts** on blocking hooks — a hanging script delays Claude's response
- **Test in the Test Bench** before deploying blocking hooks to production
