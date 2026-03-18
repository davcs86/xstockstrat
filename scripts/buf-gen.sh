#!/usr/bin/env bash
# scripts/buf-gen.sh
# Generate TypeScript, Python, and Go stubs from packages/proto/
# Run from repo root: ./scripts/buf-gen.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="$REPO_ROOT/packages/proto"

# Ensure Go plugin binaries are on PATH
export PATH="$PATH:/root/go/bin:/opt/node22/bin"

cd "$PROTO_DIR"

# ── 1. Lint protos ─────────────────────────────────────────────────────────
echo "==> buf lint"
buf lint

# ── 2. Check for breaking changes against main branch ─────────────────────
if git show-ref --verify refs/heads/main &>/dev/null; then
  echo "==> buf breaking (against local main)"
  buf breaking --against "$REPO_ROOT/.git#branch=main,subdir=packages/proto"
fi

# ── 3. Collect proto files ─────────────────────────────────────────────────
PROTOS=$(find . -name "*.proto" ! -path "./gen/*" | sort)
INCLUDE_PATHS="-I. -I/usr/local/include"

mkdir -p gen/go gen/python gen/ts

# ── 4. Generate Go stubs ───────────────────────────────────────────────────
echo "==> Generating Go stubs (protoc-gen-go + go-grpc + connect-go)"
# shellcheck disable=SC2086
protoc $INCLUDE_PATHS \
  --plugin=protoc-gen-go=/root/go/bin/protoc-gen-go \
  --plugin=protoc-gen-go-grpc=/root/go/bin/protoc-gen-go-grpc \
  --plugin=protoc-gen-connect-go=/root/go/bin/protoc-gen-connect-go \
  --go_out=gen/go --go_opt=paths=source_relative \
  --go-grpc_out=gen/go --go-grpc_opt=paths=source_relative,require_unimplemented_servers=false \
  --connect-go_out=gen/go --connect-go_opt=paths=source_relative \
  $PROTOS

# ── 5. Generate Python stubs ───────────────────────────────────────────────
echo "==> Generating Python stubs (grpcio-tools)"
# shellcheck disable=SC2086
python3 -m grpc_tools.protoc $INCLUDE_PATHS \
  --python_out=gen/python \
  --grpc_python_out=gen/python \
  $PROTOS

# Write a minimal setup.py so pip install -e . works
cat > gen/python/setup.py << 'PYSETUP'
from setuptools import setup, find_packages
setup(
    name="xstockstrat-proto",
    version="0.1.0",
    packages=find_packages(),
)
PYSETUP

# ── 6. Generate TypeScript stubs ───────────────────────────────────────────
echo "==> Generating TypeScript stubs (ts-proto + connect-es)"
# shellcheck disable=SC2086
protoc $INCLUDE_PATHS \
  --plugin=protoc-gen-ts_proto=/opt/node22/bin/protoc-gen-ts_proto \
  --ts_proto_out=gen/ts \
  "--ts_proto_opt=esModuleInterop=true,outputServices=grpc-js,env=node,useOptionals=messages,stringEnums=true" \
  $PROTOS

# shellcheck disable=SC2086
protoc $INCLUDE_PATHS \
  --plugin=protoc-gen-connect-es=/opt/node22/bin/protoc-gen-connect-es \
  --connect-es_out=gen/ts \
  "--connect-es_opt=target=ts" \
  $PROTOS

echo ""
echo "Generated stubs:"
echo "  Go:         $PROTO_DIR/gen/go/"
echo "  Python:     $PROTO_DIR/gen/python/"
echo "  TypeScript: $PROTO_DIR/gen/ts/"
echo ""
echo "==> Done."
