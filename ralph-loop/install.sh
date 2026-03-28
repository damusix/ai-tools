#!/bin/bash
set -euo pipefail

# ralph installer — https://github.com/damusix/ai-tools
# Usage: curl -fsSL https://raw.githubusercontent.com/damusix/ai-tools/main/ralph-loop/install.sh | bash

REPO="damusix/ai-tools"
BRANCH="main"
INSTALL_DIR="$HOME/.ralph"
BIN_DIR="$HOME/.local/bin"
SYMLINK="$BIN_DIR/ralph"

# ── Colors ─────────────────────────────────────────────────────────────────

red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
blue()  { printf '\033[0;34m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

# ── Prerequisites ──────────────────────────────────────────────────────────

blue "ralph: checking prerequisites..."

# Node.js 18+
if ! command -v node &>/dev/null; then
    red "ralph: node.js is required but not installed."
    echo "  Install via: https://nodejs.org/ or nvm (https://github.com/nvm-sh/nvm)"
    exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
    red "ralph: node.js 18+ is required (found v$(node --version))"
    exit 1
fi

# zx
if ! command -v zx &>/dev/null; then
    blue "ralph: installing zx..."
    npm install -g zx
fi

# ── Download ───────────────────────────────────────────────────────────────

blue "ralph: downloading from github.com/$REPO..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "https://api.github.com/repos/$REPO/tarball/$BRANCH" -o "$TMP_DIR/repo.tar.gz"

# Extract ralph-loop/ files from the tarball
# GitHub tarballs have a top-level dir like: damusix-ai-tools-<sha>/
TAR_PREFIX=$(tar -tzf "$TMP_DIR/repo.tar.gz" | head -1 | cut -d/ -f1)

if [ -z "$TAR_PREFIX" ]; then
    red "ralph: failed to read tarball — download may be corrupt"
    exit 1
fi

tar -xzf "$TMP_DIR/repo.tar.gz" -C "$TMP_DIR" \
    "$TAR_PREFIX/ralph-loop/src/" \
    "$TAR_PREFIX/ralph-loop/Dockerfile" \
    "$TAR_PREFIX/ralph-loop/docker-compose.yml" \
    "$TAR_PREFIX/ralph-loop/entrypoint.sh"

# ── Install ────────────────────────────────────────────────────────────────

blue "ralph: installing to $INSTALL_DIR..."

# Create install dir (preserve home/, claude/ if they exist from Docker)
mkdir -p "$INSTALL_DIR/src/prompts"

# Copy files
cp "$TMP_DIR/$TAR_PREFIX/ralph-loop/src/ralph.mjs"          "$INSTALL_DIR/src/ralph.mjs"
cp "$TMP_DIR/$TAR_PREFIX/ralph-loop/src/prompts/"*           "$INSTALL_DIR/src/prompts/"
cp "$TMP_DIR/$TAR_PREFIX/ralph-loop/Dockerfile"              "$INSTALL_DIR/Dockerfile"
cp "$TMP_DIR/$TAR_PREFIX/ralph-loop/docker-compose.yml"      "$INSTALL_DIR/docker-compose.yml"
cp "$TMP_DIR/$TAR_PREFIX/ralph-loop/entrypoint.sh"           "$INSTALL_DIR/entrypoint.sh"

chmod +x "$INSTALL_DIR/src/ralph.mjs"

# ── Symlink ────────────────────────────────────────────────────────────────

mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/src/ralph.mjs" "$SYMLINK"

# ── PATH ───────────────────────────────────────────────────────────────────

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    EXPORT_LINE='export PATH="$HOME/.local/bin:$PATH"'

    # Find the right shell profile
    PROFILE=""
    if [ -f "$HOME/.zshrc" ]; then
        PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.profile" ]; then
        PROFILE="$HOME/.profile"
    fi

    if [ -z "$PROFILE" ]; then
        blue "ralph: could not detect shell profile — manually add $BIN_DIR to PATH"
    elif ! grep -qF '.local/bin' "$PROFILE"; then
        echo "" >> "$PROFILE"
        echo "# ralph" >> "$PROFILE"
        echo "$EXPORT_LINE" >> "$PROFILE"
        blue "ralph: added $BIN_DIR to PATH in $PROFILE"
        blue "ralph: restart your shell or run: source $PROFILE"
    fi
fi

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
green "ralph installed!"
echo ""
echo "  install dir:  $INSTALL_DIR"
echo "  binary:       $SYMLINK"
echo ""
echo "  Get started:"
echo "    cd ~/my-project"
echo "    ralph init"
echo "    ralph help"
echo ""
echo "  Docker environment:"
echo "    ralph docker"
echo ""
echo "  Check health:"
echo "    ralph doctor"
