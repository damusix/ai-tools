#!/usr/bin/env bash
# Syncs plugin versions from their source of truth into .claude-plugin/marketplace.json
#
# Source of truth per plugin:
#   ai-memory              → ai-memory/package.json
#   auto-approve-compound-bash → cc-auto-approve-fix/.claude-plugin/plugin.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"

if [[ ! -f "$MARKETPLACE" ]]; then
    echo "marketplace.json not found at $MARKETPLACE" >&2
    exit 1
fi

changed=0

# ai-memory: source from package.json
ai_memory_version=$(jq -r '.version' "$ROOT/ai-memory/package.json")
marketplace_ai_memory=$(jq -r '.plugins[] | select(.name == "ai-memory") | .version' "$MARKETPLACE")

if [[ "$ai_memory_version" != "$marketplace_ai_memory" ]]; then
    echo "ai-memory: $marketplace_ai_memory → $ai_memory_version"
    jq --indent 4 --arg v "$ai_memory_version" '(.plugins[] | select(.name == "ai-memory")).version = $v' "$MARKETPLACE" > "$MARKETPLACE.tmp"
    mv "$MARKETPLACE.tmp" "$MARKETPLACE"
    changed=1
fi

# auto-approve-compound-bash: source from plugin.json
bash_plugin="$ROOT/cc-auto-approve-fix/.claude-plugin/plugin.json"
if [[ -f "$bash_plugin" ]]; then
    bash_version=$(jq -r '.version' "$bash_plugin")
    marketplace_bash=$(jq -r '.plugins[] | select(.name == "auto-approve-compound-bash") | .version' "$MARKETPLACE")

    if [[ "$bash_version" != "$marketplace_bash" ]]; then
        echo "auto-approve-compound-bash: $marketplace_bash → $bash_version"
        jq --indent 4 --arg v "$bash_version" '(.plugins[] | select(.name == "auto-approve-compound-bash")).version = $v' "$MARKETPLACE" > "$MARKETPLACE.tmp"
        mv "$MARKETPLACE.tmp" "$MARKETPLACE"
        changed=1
    fi
fi

if [[ $changed -eq 0 ]]; then
    echo "All versions in sync."
fi
