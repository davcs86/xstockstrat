#!/usr/bin/env bash
# scripts/run-e2e.sh
# Runs the Playwright E2E suite inside a Docker container so no Node.js,
# Playwright, or Chromium install is needed on the host.
#
# Prerequisites: Docker (already required for docker compose build)
#
# Usage:
#   ./scripts/run-e2e.sh                     # run full suite
#   ./scripts/run-e2e.sh --shard=1/2         # run shard 1 of 2
#   ./scripts/run-e2e.sh --no-cache          # force a clean image rebuild
#   ./scripts/run-e2e.sh --grep "auth"       # filter tests by name
#   ./scripts/run-e2e.sh --no-cache --shard=1/2  # combine flags
#
# The Playwright HTML report is extracted to services/xstockstrat-ui/playwright-report/
# after the run (pass --no-report to skip).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="xstockstrat-e2e"
DOCKERFILE="$REPO_ROOT/Dockerfile.e2e"
REPORT_DIR="$REPO_ROOT/services/xstockstrat-ui/playwright-report"

# ── Color helpers ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok() { echo -e "${GREEN}[OK]${NC}    $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
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
PW_ARGS=()
EXTRACT_REPORT=true

for arg in "$@"; do
  case "$arg" in
  --no-cache) BUILD_ARGS+=(--no-cache) ;;
  --no-report) EXTRACT_REPORT=false ;;
  *) PW_ARGS+=("$arg") ;;
  esac
done

# ── Optional egress-proxy CA ────────────────────────────────────────────────────
# Same pattern as localenv-setup.sh — see that file for full documentation.
BUILD_SECRETS=()
PROXY_CA="${E2E_PROXY_CA:-/root/.ccr/ca-bundle.crt}"
if [ "$PROXY_CA" != "none" ] && [ -f "$PROXY_CA" ]; then
  info "Trusting egress-proxy CA in the build: $PROXY_CA"
  BUILD_SECRETS+=(--secret "id=proxy_ca,src=$PROXY_CA")
fi

# ── Build the E2E image ───────────────────────────────────────────────────────
section "Building E2E test container ($IMAGE_NAME)"
info "This may take a few minutes on first run (Chromium + Next.js build)."

DOCKER_BUILDKIT=1 docker build \
  ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
  ${BUILD_SECRETS[@]+"${BUILD_SECRETS[@]}"} \
  -t "$IMAGE_NAME" \
  -f "$DOCKERFILE" \
  "$REPO_ROOT"

ok "Image built: $IMAGE_NAME"

# ── Run the tests ─────────────────────────────────────────────────────────────
section "Running Playwright E2E tests"

CONTAINER_NAME="xstockstrat-e2e-run-$$"
EXIT_CODE=0

# Do NOT pass --rm — we need the container to survive for report extraction.
docker run \
  --name "$CONTAINER_NAME" \
  "$IMAGE_NAME" \
  ${PW_ARGS[@]+"${PW_ARGS[@]}"} || EXIT_CODE=$?

# ── Extract report ─────────────────────────────────────────────────────────────
if [ "$EXTRACT_REPORT" = true ]; then
  section "Extracting Playwright report"
  rm -rf "$REPORT_DIR"
  docker cp "$CONTAINER_NAME:/workspace/services/xstockstrat-ui/playwright-report" "$REPORT_DIR" 2>/dev/null || {
    info "No report directory found in container (tests may not have produced one)."
  }
  if [ -d "$REPORT_DIR" ]; then
    ok "Report extracted to: services/xstockstrat-ui/playwright-report/"
    info "View it: npx playwright show-report services/xstockstrat-ui/playwright-report"
  fi
fi

# ── Cleanup container ─────────────────────────────────────────────────────────
docker rm "$CONTAINER_NAME" &>/dev/null || true

if [ "$EXIT_CODE" -eq 0 ]; then
  echo ""
  ok "All E2E tests passed."
else
  echo ""
  err "E2E tests failed (exit code $EXIT_CODE)."
fi

exit "$EXIT_CODE"
