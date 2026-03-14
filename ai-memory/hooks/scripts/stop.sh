#!/usr/bin/env bash
set -euo pipefail

HOOK_LOG="$HOME/.ai-memory/hooks.log"
exec 2>>"$HOOK_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [stop.sh] started" >&2

CONFIG_FILE="$HOME/.ai-memory/config.yaml"
PORT=24636
if [ -f "$CONFIG_FILE" ]; then
    PARSED_PORT=$(grep -A1 '^server:' "$CONFIG_FILE" | grep 'port:' | awk '{print $2}')
    if [ -n "$PARSED_PORT" ]; then
        PORT="$PARSED_PORT"
    fi
fi
BASE="http://localhost:$PORT"

# Read conversation data from stdin
PAYLOAD=$(cat)

# POST to enqueue endpoint (non-blocking)
curl -sf -X POST "$BASE/enqueue" \
    -H "Content-Type: application/json" \
    -d "{\"project\": \"$PWD\", \"payload\": $PAYLOAD}" \
    > /dev/null 2>&1 || true

exit 0
