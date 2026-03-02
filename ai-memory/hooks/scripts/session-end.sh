#!/usr/bin/env bash
# SessionEnd hook: notify server of session end
set -euo pipefail

CONFIG_FILE="$HOME/.ai-memory/config.yaml"
PORT=24636
if [ -f "$CONFIG_FILE" ]; then
    PARSED_PORT=$(grep -A1 '^server:' "$CONFIG_FILE" | grep 'port:' | awk '{print $2}')
    if [ -n "$PARSED_PORT" ]; then
        PORT="$PARSED_PORT"
    fi
fi
BASE="http://localhost:$PORT"

PAYLOAD=$(cat)

curl -sf --max-time 2 -X POST "$BASE/enqueue" \
    -H "Content-Type: application/json" \
    -d "{\"project\": \"$PWD\", \"payload\": $PAYLOAD}" \
    > /dev/null 2>&1 || true

exit 0
