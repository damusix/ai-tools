#!/usr/bin/env bash
# shellcheck shell=bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINK_PATH="$SCRIPT_DIR/.approve-compound-bash-current"

# Fast path: if we already cached a platform-specific symlink, use it.
if [[ -x "$LINK_PATH" ]]; then
	exec "$LINK_PATH" "$@"
fi

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

BIN_PATH="$SCRIPT_DIR/bin/approve-compound-bash-${os}-${arch}"

if [[ ! -x "$BIN_PATH" ]]; then
	exit 0
fi

# Cache resolved binary for future runs. Ignore failures (read-only fs, etc.).
ln -sfn "$BIN_PATH" "$LINK_PATH" 2>/dev/null || true

if [[ -x "$LINK_PATH" ]]; then
	exec "$LINK_PATH" "$@"
fi

exec "$BIN_PATH" "$@"
