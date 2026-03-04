#!/usr/bin/env bash
set -euo pipefail

echo "[ai-memory] Setting up..."

# Check deps
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found. Install Node.js 22+."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not found. Install with: npm install -g pnpm"; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "ERROR: sqlite3 not found"; exit 1; }

# Verify FTS5
sqlite3 :memory: "CREATE VIRTUAL TABLE t USING fts5(x)" 2>/dev/null || {
    echo "ERROR: SQLite FTS5 not available"; exit 1;
}

# Install deps and build
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$PLUGIN_ROOT"
pnpm install --frozen-lockfile
pnpm build

echo "[ai-memory] Setup complete. Start with: node dist/server.js"
