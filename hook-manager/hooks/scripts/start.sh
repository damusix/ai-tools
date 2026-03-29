#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$HOME/.ai-hooks"
PORT_FILE="$STATE_DIR/.port"
STDIN_DATA=$(cat)

# Start server if not already running
if ! curl -sf "http://localhost:$(cat "$PORT_FILE" 2>/dev/null || echo 47821)/health" >/dev/null 2>&1; then
    bash "$SCRIPT_DIR/hook-manager.sh" &
    disown

    # Wait for health (up to 5 seconds)
    for i in $(seq 1 50); do
        PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 47821)
        if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
            break
        fi
        sleep 0.1
    done
fi

PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 47821)

# Forward SessionStart event to server
curl -sf -X POST "http://localhost:$PORT/hook/SessionStart" \
    -H "Content-Type: application/json" \
    -d "$STDIN_DATA" 2>/dev/null || true
