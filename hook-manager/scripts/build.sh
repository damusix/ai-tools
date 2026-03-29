#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"

VERSION="${VERSION:-dev}"
COMMIT="${COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf unknown)}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

mkdir -p "$BIN_DIR"

build_target() {
    local goos="$1"
    local goarch="$2"
    local output="$BIN_DIR/hook-manager-${goos}-${goarch}"

    echo "Building ${goos}/${goarch}..."
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
        -trimpath \
        -ldflags "-s -w \
            -X main.version=$VERSION \
            -X main.commit=$COMMIT \
            -X main.buildDate=$BUILD_DATE" \
        -o "$output" \
        ./cmd/server

    chmod +x "$output"
}

cd "$ROOT_DIR"
build_target darwin amd64
build_target darwin arm64
build_target linux amd64
build_target linux arm64

echo "Built binaries in $BIN_DIR"
