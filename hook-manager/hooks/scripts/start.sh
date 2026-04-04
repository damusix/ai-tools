#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$HOME/.ai-hooks"
PORT_FILE="$STATE_DIR/.port"
LOG_FILE="$STATE_DIR/startup.log"
STDIN_DATA=$(cat)

mkdir -p "$STATE_DIR"

log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG_FILE"
}

# Start server if not already running
if ! curl -sf "http://localhost:$(cat "$PORT_FILE" 2>/dev/null || echo 47821)/health" >/dev/null 2>&1; then
    log "Starting hook-manager server..."
    bash "$SCRIPT_DIR/hook-manager.sh" >> "$LOG_FILE" 2>&1 &
    disown

    # Wait for health (up to 5 seconds)
    started=false
    for i in $(seq 1 50); do
        PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 47821)
        if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
            started=true
            break
        fi
        sleep 0.1
    done

    if [[ "$started" != "true" ]]; then
        log "ERROR: server failed to start within 5 seconds"
        echo "hook-manager: server failed to start (see $LOG_FILE)" >&2
    fi
fi

PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 47821)

# Forward SessionStart event to server
curl -sf -X POST "http://localhost:$PORT/hook/SessionStart" \
    -H "Content-Type: application/json" \
    -d "$STDIN_DATA" 2>/dev/null || true
