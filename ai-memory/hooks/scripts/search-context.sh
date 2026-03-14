#!/usr/bin/env bash
# PreToolUse hook: inject taxonomy context before search_memories calls
set -euo pipefail

HOOK_LOG="$HOME/.ai-memory/hooks.log"
exec 2>>"$HOOK_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [search-context.sh] started" >&2

CONFIG_FILE="$HOME/.ai-memory/config.yaml"
PORT=24636
if [ -f "$CONFIG_FILE" ]; then
    PARSED_PORT=$(grep -A1 '^server:' "$CONFIG_FILE" | grep 'port:' | awk '{print $2}')
    if [ -n "$PARSED_PORT" ]; then
        PORT="$PARSED_PORT"
    fi
fi
BASE="http://localhost:$PORT"

SUMMARY=$(curl -sf "$BASE/api/taxonomy-summary?project=$PWD" 2>/dev/null || true)

if [ -z "$SUMMARY" ]; then
    exit 0
fi

echo "$SUMMARY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
summary = data.get('summary', '')
if not summary:
    sys.exit(0)
output = {'additionalContext': '[ai-memory] Available taxonomy for filtering:\n' + summary}
print(json.dumps(output))
" 2>/dev/null || true

exit 0
