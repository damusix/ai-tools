#!/usr/bin/env bash
set -euo pipefail

HOOK_LOG="$HOME/.ai-memory/hooks.log"
exec 2>>"$HOOK_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [startup.sh] started" >&2

CONFIG_FILE="$HOME/.ai-memory/config.yaml"
PORT=24636
if [ -f "$CONFIG_FILE" ]; then
    PARSED_PORT=$(grep -A1 '^server:' "$CONFIG_FILE" 2>/dev/null | grep 'port:' | awk '{print $2}' || true)
    if [ -n "$PARSED_PORT" ]; then
        PORT="$PARSED_PORT"
    fi
fi
BASE="http://localhost:$PORT"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Run setup diagnostics (cascading: install → rebuild native → build)
CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PLUGIN_ROOT/scripts/setup.sh" 2>&1 || {
    echo '{"systemMessage": "[ai-memory] Setup failed. Check that node, pnpm, and sqlite3 are installed."}'
    exit 0
}

# Update .mcp.json in plugin root and Claude's cache with current port
MCP_JSON="{\"ai-memory\":{\"command\":\"npx\",\"args\":[\"-y\",\"mcp-remote\",\"http://localhost:$PORT/mcp\"]}}"

echo "$MCP_JSON" > "$PLUGIN_ROOT/.mcp.json"

for f in "$HOME/.claude/plugins/cache"/*/ai-memory/*/.mcp.json; do
    [ -f "$f" ] && echo "$MCP_JSON" > "$f"
done

# Kill stale server if running on a different port
PID_FILE="$HOME/.ai-memory/ai-memory.pid"
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        # Process exists — check if it's responding on the configured port
        if ! curl -sf "$BASE/health" > /dev/null 2>&1; then
            # Running but not on our port — kill it
            kill "$OLD_PID" 2>/dev/null || true
            sleep 0.3
        fi
    fi
fi

# Check if server is running
if ! curl -sf "$BASE/health" > /dev/null 2>&1; then
    # Start server in background
    nohup node "$PLUGIN_ROOT/dist/server.js" >> ~/.ai-memory/server.log 2>&1 &

    # Wait for it to be ready (max 5 seconds)
    for i in $(seq 1 50); do
        if curl -sf "$BASE/health" > /dev/null 2>&1; then
            break
        fi
        sleep 0.1
    done

    # Final check
    if ! curl -sf "$BASE/health" > /dev/null 2>&1; then
        echo '{"systemMessage": "[ai-memory] Server failed to start. Memory tools unavailable this session."}'
        exit 0
    fi
fi

# Fetch context for current project
CONTEXT=$(curl -sf -X POST "$BASE/context" \
    -H "Content-Type: application/json" \
    -d "{\"project\": \"$PWD\"}" 2>/dev/null || echo '{"systemMessage": "[ai-memory] Failed to load memory context."}')

echo "$CONTEXT"
