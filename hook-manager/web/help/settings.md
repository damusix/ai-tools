# Settings

Configure the Hook Manager server, runtimes, and extension mappings.

## Server

### Port

The HTTP port Hook Manager listens on. Default: **47821**.

This must match the port in your `hooks.json` file — the file that registers Hook Manager with Claude Code. If you change the port here, update the URLs in `hooks.json` too.

### Log Level

Controls how verbose the execution logs are:

| Level | What's Logged |
|-------|---------------|
| **debug** | Everything — including full payloads and internal state |
| **info** | Hook executions, results, exit codes, timing |
| **warn** | Warnings and errors only |
| **error** | Only errors |

Use **debug** when troubleshooting hook behavior. Use **info** for normal operation.

## Runtimes

Hook Manager auto-detects which script runtimes are installed on your machine (bash, python3, node, bun, go, ruby, perl, deno). Detection runs at startup and refreshes hourly.

### Extension Mappings

Extension mappings tell Hook Manager which runtime to use for each file type:

| Extension | Default Runtime |
|-----------|----------------|
| `.sh` | bash |
| `.py` | python3 |
| `.js` | node (or bun if available) |
| `.ts` | bun (or node) |
| `.rb` | ruby |
| `.go` | go run |

You can change the default mapping (e.g. switch `.js` from node to bun) or add custom extensions.

### Custom Extensions

Add mappings for any file type. For example, map `.pl` to `perl` or `.lua` to `lua`. Custom mappings can be deleted; built-in mappings can only be reassigned.

## Storage

| Path | Purpose |
|------|---------|
| `~/.ai-hooks/config.yaml` | All configuration (hooks, server, runtimes) |
| `~/.ai-hooks/scripts/` | Managed script files |
| `~/.ai-hooks/hooks.log` | Execution logs (5MB rotation, 3 backups) |
