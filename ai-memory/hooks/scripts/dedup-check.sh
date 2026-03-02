#!/usr/bin/env bash
# PreToolUse hook: warn about potential duplicate memories before save
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

INPUT=$(cat)

echo "$INPUT" | python3 -c "
import sys, json, urllib.request

data = json.load(sys.stdin)
content = data.get('tool_input', {}).get('content', '')
if not content:
    sys.exit(0)

req = urllib.request.Request(
    '${BASE}/api/recall',
    data=json.dumps({'prompt': content, 'project': '${PWD}'}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    with urllib.request.urlopen(req, timeout=2) as resp:
        result = json.load(resp)
except Exception:
    sys.exit(0)

memories = result.get('memories', [])
if not memories:
    sys.exit(0)

lines = []
for m in memories:
    lines.append(f\"  - [id:{m.get('id','')}] {m.get('content','')}\")

warning = '[ai-memory] Similar memories already exist:\n' + '\n'.join(lines) + '\nConsider if this is a duplicate before saving.'
print(json.dumps({'additionalContext': warning}))
" 2>/dev/null || true

exit 0
