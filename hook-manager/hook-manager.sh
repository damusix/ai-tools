#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINK_PATH="$SCRIPT_DIR/.hook-manager-current"

[[ -x "$LINK_PATH" ]] && exec "$LINK_PATH" "$@"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
Darwin) os="darwin" ;;
Linux) os="linux" ;;
*) exit 0 ;;
esac

case "$arch" in
arm64 | aarch64) arch="arm64" ;;
x86_64 | amd64) arch="amd64" ;;
*) exit 0 ;;
esac

BIN_PATH="$SCRIPT_DIR/bin/hook-manager-${os}-${arch}"
[[ -x "$BIN_PATH" ]] || exit 0

ln -sfn "$BIN_PATH" "$LINK_PATH" 2>/dev/null || true
[[ -x "$LINK_PATH" ]] && exec "$LINK_PATH" "$@"
exec "$BIN_PATH" "$@"
