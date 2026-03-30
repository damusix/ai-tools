# Hook Manager

Hook Manager is a local orchestration server for Claude Code hooks. It sits between Claude Code and your custom scripts, routing lifecycle events to the right handler.

## How It Works

1. **Claude Code fires an event** (e.g. a tool is about to run)
2. **Hook Manager receives it** as an HTTP POST with a JSON payload
3. **Your hooks are matched** by event type and optional regex filter
4. **Matching scripts execute** concurrently, receiving the payload on stdin
5. **Outputs are aggregated** and returned to Claude Code

## Key Concepts

- **Hook** — a registered handler for a Claude Code event. Each hook has a name, event type, and either a shell command or a managed script.
- **Managed Script** — a script file stored in `~/.ai-hooks/scripts/`. The runtime (bash, python, node, etc.) is auto-detected from the file extension.
- **Matcher** — an optional regex that filters when a hook fires. For tool events, it matches against the tool name; for other events, it matches a relevant field.
- **Blocking** — a script can return exit code **2** to block the action Claude Code was about to take. Only certain events support blocking.

## Architecture

```
Claude Code  →  HTTP POST  →  Hook Manager Server (localhost:47821)
                                    ↓
                              Load config.yaml
                                    ↓
                              Match hooks (event + regex)
                                    ↓
                              Execute scripts (concurrent)
                                    ↓
                              Aggregate output
                                    ↓
                              Return to Claude Code
```

## Configuration

All state lives in `~/.ai-hooks/`:

| Path | Purpose |
|------|---------|
| `config.yaml` | Hook definitions, server settings, runtimes |
| `scripts/` | Managed script files |
| `hooks.log` | Execution logs (rotating, 5MB) |
| `.port` | Current server port (for health checks) |
