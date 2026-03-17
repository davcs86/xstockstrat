#!/usr/bin/env bash
# scripts/buf-gen.sh
# Generate TypeScript, Python, and Go stubs from packages/proto/
# Run from repo root: ./scripts/buf-gen.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$REPO_ROOT/packages/proto"

echo "==> Running buf generate in $PROTO_DIR"
cd "$PROTO_DIR"

# Lint protos first
echo "==> buf lint"
buf lint

# Check for breaking changes against main branch
if git rev-parse --verify origin/main &>/dev/null; then
  echo "==> buf breaking (against origin/main)"
  buf breaking --against 'https://github.com/xstockstrat/orchestration.git#branch=main,subdir=packages/proto'
fi

# Generate stubs
echo "==> buf generate"
buf generate

echo ""
echo "Generated stubs:"
echo "  Go:         $PROTO_DIR/gen/go/"
echo "  Python:     $PROTO_DIR/gen/python/"
echo "  TypeScript: $PROTO_DIR/gen/ts/"
echo ""
echo "==> Done."
