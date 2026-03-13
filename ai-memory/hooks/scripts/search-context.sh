#!/usr/bin/env bash
# PreToolUse hook: inject taxonomy context before search_memories
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

SUMMARY=$(curl -sf --max-time 2 "$BASE/api/taxonomy-summary?project=$PWD" 2>/dev/null || true)

if [ -n "$SUMMARY" ]; then
    echo "$SUMMARY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
summary = data.get('summary', '')
if summary:
    print(json.dumps({'additionalContext': '[ai-memory] Available taxonomy for filtering:\n' + summary + '\nUse these domain, category, and tag values to narrow your search.'}))
" 2>/dev/null || true
fi

exit 0
