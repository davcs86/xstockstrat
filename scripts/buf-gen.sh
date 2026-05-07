#!/usr/bin/env bash
# scripts/buf-gen.sh
# Generate TypeScript, Python, and Go stubs from packages/proto/
# Run from repo root: ./scripts/buf-gen.sh
#
# Prerequisites (local dev):
#   Go plugins:   go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
#                 go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
#                 go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest
#
# Python (buf.build/protocolbuffers/python, buf.build/grpc/python) and
# TypeScript (buf.build/community/stephenh-ts-proto) plugins are remote —
# buf downloads them from BSR automatically; no local install required.
#
# Go plugin binaries are looked up on PATH. The PATH export below covers the
# default local dev install locations.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$REPO_ROOT/packages/proto"

# Add common plugin install locations to PATH for local dev
export PATH="$PATH:/root/go/bin:${HOME}/go/bin:/opt/node22/bin"

cd "$PROTO_DIR"

# ── 1. Lint protos ─────────────────────────────────────────────────────────
echo "==> buf lint"
buf lint

# ── 2. Check for breaking changes against main-dev (dev trunk) ────────────
AGAINST_BRANCH="${AGAINST_BRANCH:-main-dev}"
if [ -n "$AGAINST_BRANCH" ] && git show-ref --verify "refs/heads/$AGAINST_BRANCH" &>/dev/null; then
  echo "==> buf breaking (against $AGAINST_BRANCH)"
  buf breaking --against "$REPO_ROOT/.git#branch=$AGAINST_BRANCH,subdir=packages/proto"
fi

# ── 3. Generate all stubs via buf generate ───────────────────────────────��─
mkdir -p gen/go gen/python gen/ts

echo "==> buf generate (Go + Python + TypeScript stubs)"
buf generate

# Write a minimal setup.py so pip install -e . works
cat > gen/python/setup.py << 'PYSETUP'
from setuptools import setup, find_packages
setup(
    name="xstockstrat-proto",
    version="0.1.0",
    packages=find_packages(),
)
PYSETUP

# ── 4. Compile TypeScript stubs to JS ──────────────────────────────────────
echo "==> Compiling gen/ts to JavaScript (tsc)"
if [ -f "$REPO_ROOT/pnpm-lock.yaml" ]; then
  # Workspace install exists — use filter to build just the proto package
  (cd "$REPO_ROOT" && pnpm --filter @xstockstrat/proto run build)
else
  # Fallback: standalone tsc inside gen/ts (requires npm install first)
  (cd "$REPO_ROOT/packages/proto/gen/ts" && npx tsc)
fi

echo ""
echo "Generated stubs:"
echo "  Go:            $PROTO_DIR/gen/go/"
echo "  Python:        $PROTO_DIR/gen/python/"
echo "  TypeScript:    $PROTO_DIR/gen/ts/"
echo "  TypeScript JS: $PROTO_DIR/gen/ts/dist/"
echo ""
echo "==> Done."
