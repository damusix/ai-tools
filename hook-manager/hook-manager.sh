#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINK_PATH="$SCRIPT_DIR/.hook-manager-current"
LOG_DIR="$HOME/.ai-hooks"
LOG_FILE="$LOG_DIR/startup.log"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG_FILE"
}

[[ -x "$LINK_PATH" ]] && exec "$LINK_PATH" "$@"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
Darwin) os="darwin" ;;
Linux) os="linux" ;;
*)
    log "ERROR: unsupported OS: $os"
    echo "hook-manager: unsupported OS: $os" >&2
    exit 1
    ;;
esac

case "$arch" in
arm64 | aarch64) arch="arm64" ;;
x86_64 | amd64) arch="amd64" ;;
*)
    log "ERROR: unsupported architecture: $arch"
    echo "hook-manager: unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

BIN_PATH="$SCRIPT_DIR/bin/hook-manager-${os}-${arch}"
if [[ ! -x "$BIN_PATH" ]]; then
    log "ERROR: binary not found: $BIN_PATH"
    echo "hook-manager: binary not found: $BIN_PATH" >&2
    echo "hook-manager: run 'bash $SCRIPT_DIR/scripts/build.sh' to compile" >&2
    exit 1
fi

ln -sfn "$BIN_PATH" "$LINK_PATH" 2>/dev/null || true
[[ -x "$LINK_PATH" ]] && exec "$LINK_PATH" "$@"
exec "$BIN_PATH" "$@"
