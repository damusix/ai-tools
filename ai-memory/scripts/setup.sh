#!/usr/bin/env bash
set -euo pipefail

echo "[ai-memory] Running setup diagnostics..."

# Check deps
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found. Install Node.js 22+."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not found. Install with: npm install -g pnpm"; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "ERROR: sqlite3 not found"; exit 1; }

# Verify FTS5
sqlite3 :memory: "CREATE VIRTUAL TABLE t USING fts5(x)" 2>/dev/null || {
    echo "ERROR: SQLite FTS5 not available"; exit 1;
}

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$PLUGIN_ROOT"

# 1. If no node_modules → install dependencies
if [ ! -d "$PLUGIN_ROOT/node_modules" ]; then
    echo "[ai-memory] Installing dependencies..."
    pnpm install --frozen-lockfile
fi

# 2. If no native addon → rebuild better-sqlite3
if ! find "$PLUGIN_ROOT/node_modules/better-sqlite3" -name "*.node" 2>/dev/null | grep -q .; then
    echo "[ai-memory] Rebuilding native addon..."
    npx pnpm rebuild better-sqlite3
fi

# 3. If no built server → run build
if [ ! -f "$PLUGIN_ROOT/dist/server.js" ]; then
    echo "[ai-memory] Building server..."
    pnpm build
fi

echo "[ai-memory] Setup complete."
