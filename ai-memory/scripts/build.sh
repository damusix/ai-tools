#!/usr/bin/env bash
set -euo pipefail

echo "Building server..."
tsup

echo "Copying prompts..."
rm -rf dist/prompts
cp -r src/prompts dist/prompts

echo "Building UI..."
vite build

echo "Copying help files..."
cp -r src/ui/help dist/ui/help

echo "Syncing versions..."
bash "$(dirname "$0")/../../scripts/sync-versions.sh"

echo "Build complete."
