#!/usr/bin/env bash
# scripts/localenv-setup.sh
# Generates proto stubs using a Docker container so no Go/Python/Node install is
# needed on the host. Run once after cloning, then re-run whenever .proto files change.
#
# Prerequisites: Docker (already required for docker compose build)
#
# Usage:
#   ./scripts/localenv-setup.sh            # build image + generate stubs
#   ./scripts/localenv-setup.sh --no-cache # force a clean image rebuild

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="xstockstrat-codegen"
DOCKERFILE="$REPO_ROOT/Dockerfile.codegen"

# ── Color helpers ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
err()     { echo -e "${RED}[ERROR]${NC} $*" >&2; }
section() { echo -e "\n${BOLD}${CYAN}===> $*${NC}"; }

# ── Require Docker ─────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  err "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker info &>/dev/null; then
  err "Docker daemon is not running. Start Docker Desktop and try again."
  exit 1
fi

# ── Parse flags ────────────────────────────────────────────────────────────────
BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-cache) BUILD_ARGS+=(--no-cache) ;;
    *) err "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Build the codegen image ────────────────────────────────────────────────────
section "Building proto-gen container ($IMAGE_NAME)"
info "This may take a few minutes on first run."

docker build \
  ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
  --platform linux/amd64 \
  -t "$IMAGE_NAME" \
  -f "$DOCKERFILE" \
  "$REPO_ROOT"

ok "Image built: $IMAGE_NAME"

# ── Run buf-gen.sh inside the container ───────────────────────────────────────
section "Generating proto stubs"
info "Running scripts/buf-gen.sh inside container (output written to packages/proto/gen/)"

docker run --rm \
  --platform linux/amd64 \
  -v "$REPO_ROOT:/workspace" \
  -w /workspace \
  "$IMAGE_NAME" \
  ./scripts/buf-gen.sh

ok "Stubs written to:"
ok "  packages/proto/gen/go/"
ok "  packages/proto/gen/python/"
ok "  packages/proto/gen/ts/"

echo ""
echo -e "${BOLD}Done. You can now run:${NC}"
echo "  ./scripts/bootstrap.sh"
echo ""
echo "bootstrap.sh will:"
echo "  1. Create .env file (if it doesn't exist) — interactive setup for secrets"
echo "  2. Check prerequisites (Docker, language toolchains)"
echo "  3. Install service dependencies"
echo "  4. Prepare the database"
