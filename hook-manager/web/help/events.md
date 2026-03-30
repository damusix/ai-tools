# Events Reference

Every Claude Code lifecycle event that Hook Manager can intercept. Each section shows the payload your script receives on stdin.

## Tool Events

### PreToolUse

Fires **before** a tool executes. Can block the tool from running.

- **Matcher field:** `tool_name`
- **Blockable:** Yes

```json
{
    "hook_event_name": "PreToolUse",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "tool_name": "Bash",
    "tool_input": {
        "command": "ls -la",
        "description": "List files"
    }
}
```

### PostToolUse

Fires **after** a tool succeeds. Useful for reacting to results.

- **Matcher field:** `tool_name`
- **Blockable:** No

```json
{
    "hook_event_name": "PostToolUse",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "tool_name": "Write",
    "tool_input": {
        "file_path": "test.txt",
        "content": "hello"
    },
    "tool_response": {
        "filePath": "test.txt",
        "success": true
    }
}
```

### PostToolUseFailure

Fires after a tool **fails**. Good for error recovery or alerting.

- **Matcher field:** `tool_name`
- **Blockable:** No

```json
{
    "hook_event_name": "PostToolUseFailure",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "tool_name": "Bash",
    "tool_input": { "command": "false" },
    "error": "Command exited with non-zero status code 1"
}
```

### PermissionRequest

Fires when Claude asks for permission to use a tool. Can auto-allow or deny.

- **Matcher field:** `tool_name`
- **Blockable:** Yes

```json
{
    "hook_event_name": "PermissionRequest",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "tool_name": "Bash",
    "tool_input": {
        "command": "rm -rf node_modules"
    }
}
```

## User Interaction

### UserPromptSubmit

Fires when the user submits a prompt. Can block or add context.

- **Matcher field:** (none)
- **Blockable:** Yes

```json
{
    "hook_event_name": "UserPromptSubmit",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "prompt": "Fix the login bug"
}
```

### Notification

Fires when a system notification is sent (permission prompts, idle alerts).

- **Matcher field:** `notification_type`
- **Blockable:** No

```json
{
    "hook_event_name": "Notification",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "notification_type": "permission_prompt",
    "message": "Claude needs permission",
    "title": "Permission needed"
}
```

## Session Lifecycle

### SessionStart

Fires when a session begins or resumes. Good for setup and context injection.

- **Matcher field:** `source`
- **Blockable:** No

```json
{
    "hook_event_name": "SessionStart",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "source": "startup",
    "model": "claude-sonnet-4-6"
}
```

### SessionEnd

Fires when a session terminates. Good for cleanup and state saving.

- **Matcher field:** `reason`
- **Blockable:** No

```json
{
    "hook_event_name": "SessionEnd",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "reason": "clear"
}
```

## Agent Lifecycle

### Stop

Fires when the main agent finishes its response. Can force it to continue.

- **Matcher field:** (none)
- **Blockable:** Yes

```json
{
    "hook_event_name": "Stop",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "stop_hook_active": false,
    "last_assistant_message": "I have completed the refactoring."
}
```

### StopFailure

Fires on API errors during response generation (rate limits, auth failures).

- **Matcher field:** `error`
- **Blockable:** No

```json
{
    "hook_event_name": "StopFailure",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "error": "rate_limit"
}
```

### SubagentStart

Fires when a subagent is spawned.

- **Matcher field:** `agent_type`
- **Blockable:** No

```json
{
    "hook_event_name": "SubagentStart",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "agent_id": "agent-def456",
    "agent_type": "Explore"
}
```

### SubagentStop

Fires when a subagent finishes. Can force it to continue.

- **Matcher field:** `agent_type`
- **Blockable:** Yes

```json
{
    "hook_event_name": "SubagentStop",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "agent_id": "agent-def456",
    "agent_type": "Explore",
    "last_assistant_message": "Analysis complete."
}
```

## Context & Configuration

### InstructionsLoaded

Fires when CLAUDE.md or rules files are loaded.

- **Matcher field:** `load_reason`
- **Blockable:** No

```json
{
    "hook_event_name": "InstructionsLoaded",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "file_path": "/Users/you/project/CLAUDE.md",
    "load_reason": "session_start"
}
```

### ConfigChange

Fires when a configuration file changes. Can block the change.

- **Matcher field:** `source`
- **Blockable:** Yes

```json
{
    "hook_event_name": "ConfigChange",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "source": "user_settings",
    "file_path": "~/.claude/settings.json"
}
```

### CwdChanged

Fires when the working directory changes.

- **Matcher field:** (none)
- **Blockable:** No

```json
{
    "hook_event_name": "CwdChanged",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project/src",
    "old_cwd": "/Users/you/project",
    "new_cwd": "/Users/you/project/src"
}
```

### FileChanged

Fires when a watched file changes on disk.

- **Matcher field:** `file_path`
- **Blockable:** No

```json
{
    "hook_event_name": "FileChanged",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "file_path": "/Users/you/project/.envrc",
    "event": "change"
}
```

### PreCompact

Fires before context compaction. Save important context here.

- **Matcher field:** (none)
- **Blockable:** No

```json
{
    "hook_event_name": "PreCompact",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project"
}
```

### PostCompact

Fires after context compaction. Restore or inject context here.

- **Matcher field:** (none)
- **Blockable:** No

```json
{
    "hook_event_name": "PostCompact",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project"
}
```

## Collaboration

### TeammateIdle

Fires when a team teammate goes idle. Can keep it working.

- **Matcher field:** (none)
- **Blockable:** Yes

```json
{
    "hook_event_name": "TeammateIdle",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "teammate_name": "researcher",
    "team_name": "my-project"
}
```

### TaskCompleted

Fires when a task is marked complete. Can reject the completion.

- **Matcher field:** (none)
- **Blockable:** Yes

```json
{
    "hook_event_name": "TaskCompleted",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "task_id": "task-001",
    "task_subject": "Implement auth"
}
```

## Workspace

### WorktreeCreate

Fires when a git worktree is created. Can block or customize setup.

- **Matcher field:** (none)
- **Blockable:** Yes

```json
{
    "hook_event_name": "WorktreeCreate",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "name": "feature-auth"
}
```

### WorktreeRemove

Fires when a git worktree is removed.

- **Matcher field:** (none)
- **Blockable:** No

```json
{
    "hook_event_name": "WorktreeRemove",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "name": "feature-auth",
    "path": "/Users/you/project/.worktrees/feature-auth"
}
```

## MCP (Model Context Protocol)

### Elicitation

Fires when an MCP server requests user input. Can auto-fill or block.

- **Matcher field:** `mcp_server`
- **Blockable:** Yes

```json
{
    "hook_event_name": "Elicitation",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "mcp_server": "memory",
    "tool_name": "mcp__memory__save"
}
```

### ElicitationResult

Fires after the user responds to an MCP elicitation.

- **Matcher field:** `mcp_server`
- **Blockable:** Yes

```json
{
    "hook_event_name": "ElicitationResult",
    "session_id": "sess_abc123",
    "cwd": "/Users/you/project",
    "mcp_server": "memory",
    "tool_name": "mcp__memory__save"
}
```
