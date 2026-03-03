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
	local output="$BIN_DIR/approve-compound-bash-${goos}-${goarch}"

	CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
		-trimpath \
		-ldflags "-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.buildDate=$BUILD_DATE" \
		-o "$output" \
		./cmd/approve-compound-bash

	chmod +x "$output"
}

build_target darwin amd64
build_target darwin arm64
build_target linux amd64
build_target linux arm64

(
	cd "$BIN_DIR"
	shasum -a 256 \
		approve-compound-bash-darwin-amd64 \
		approve-compound-bash-darwin-arm64 \
		approve-compound-bash-linux-amd64 \
		approve-compound-bash-linux-arm64 >SHA256SUMS
)

echo "Built binaries in $BIN_DIR"
