#!/usr/bin/env bash
# UserPromptSubmit hook: surface relevant memories for the user's prompt
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

# Read stdin and process entirely in python3 for safe JSON handling
INPUT=$(cat)

RESULT=$(echo "$INPUT" | python3 -c "
import sys, json, urllib.request

data = json.load(sys.stdin)
prompt = data.get('prompt', '')
if not prompt:
    sys.exit(0)

req = urllib.request.Request(
    '${BASE}/api/recall',
    data=json.dumps({'prompt': prompt, 'project': '${PWD}'}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
try:
    with urllib.request.urlopen(req, timeout=1) as resp:
        result = json.load(resp)
except Exception:
    sys.exit(0)

memories = result.get('memories', [])
if not memories:
    sys.exit(0)

lines = []
for m in memories:
    tags = m.get('tags', '')
    tag_str = f' [{tags}]' if tags else ''
    lines.append(f\"- [{m.get('category','fact')}] {m.get('content','')}{tag_str}\")

output = {'additionalContext': '[ai-memory] Relevant memories:\n' + '\n'.join(lines)}
print(json.dumps(output))
" 2>/dev/null || true)

if [ -n "$RESULT" ]; then
    echo "$RESULT"
fi

exit 0
