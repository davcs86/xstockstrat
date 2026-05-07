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
#   TypeScript plugins (installed via pnpm workspace — packages/proto/gen/ts devDeps):
#                 ts-proto (@xstockstrat/proto devDependency)
#                 @bufbuild/protoc-gen-es (@xstockstrat/proto devDependency)
#                 @connectrpc/protoc-gen-connect-es (@xstockstrat/proto devDependency)
#
#   Python stubs: grpcio-tools  (pip install grpcio-tools)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$REPO_ROOT/packages/proto"

# Add Go plugin binaries to PATH
export PATH="$PATH:/root/go/bin:${HOME}/go/bin:/opt/node22/bin"

# Add local workspace node_modules/.bin so buf can find TypeScript proto plugins
# (protoc-gen-ts_proto, protoc-gen-es, protoc-gen-connect-es installed as devDeps
# in packages/proto/gen/ts/package.json and hoisted by pnpm to the workspace root)
export PATH="$PATH:$REPO_ROOT/node_modules/.bin:$PROTO_DIR/gen/ts/node_modules/.bin"

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

# ── 3. Generate Go + TypeScript stubs via buf generate ────────────────────
mkdir -p gen/go gen/python gen/ts

echo "==> buf generate (Go + TypeScript stubs)"
buf generate

# ── 4. Generate Python stubs via grpcio-tools ─────────────────────────────
# grpcio-tools bundles libprotoc so no separate protoc install is needed.
# Generates *_pb2.py (protobuf messages) and *_pb2_grpc.py (gRPC stubs).
echo "==> grpcio-tools: generating Python stubs"
GRPC_PROTO_PATH=$(python3 -c \
  "import grpc_tools, os; print(os.path.join(os.path.dirname(grpc_tools.__file__), '_proto'))")

# Collect all .proto source files (excluding gen/)
PROTO_FILES=$(find . -name "*.proto" | grep -v "^\./gen/" | sort | tr '\n' ' ')

# shellcheck disable=SC2086
python3 -m grpc_tools.protoc \
  -I . \
  -I "$GRPC_PROTO_PATH" \
  --python_out=gen/python \
  --grpc_python_out=gen/python \
  $PROTO_FILES

# Ensure every package directory has an __init__.py so the stubs are importable
find gen/python -type d | while read -r dir; do
  touch "$dir/__init__.py"
done

# Write a minimal setup.py so pip install -e . works
cat > gen/python/setup.py << 'PYSETUP'
from setuptools import setup, find_packages
setup(
    name="xstockstrat-proto",
    version="0.1.0",
    packages=find_packages(),
)
PYSETUP

# ── 5. Compile TypeScript stubs to JS ──────────────────────────────────────
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
