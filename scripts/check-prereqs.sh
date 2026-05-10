#!/usr/bin/env bash
# scripts/check-prereqs.sh
# Checks tools required to run xstockstrat-orchestration locally.
# Development is fully Docker-based — only git and docker are required on the host.
#
# NOT required on the host (all provided by Docker containers):
#   go, python3, node, pnpm  — services build and run inside Docker
#   buf                       — proto codegen runs inside Dockerfile.codegen via localenv-setup.sh
#   migrate                   — migrations run inside scripts/Dockerfile.migrate via docker-compose
#   psql                      — available inside the migrate container
#
# Language toolchains (go/python3/node/pnpm) are only needed if you want to run
# unit tests or use IDE language-server features outside Docker.
#
# Usage:
#   ./scripts/check-prereqs.sh          # check all tools
#   ./scripts/check-prereqs.sh --quiet  # suppress output; exit code only

set -euo pipefail

QUIET=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

log()  { [ "$QUIET" -eq 0 ] && echo "$*" || true; }
ok()   { log "  ✓ $*"; }
fail() { log "  ✗ $*"; }

MISSING=0

check_docker() {
  if ! command -v docker &>/dev/null; then
    fail "docker not found  →  https://docs.docker.com/get-docker/"
    MISSING=1
    return
  fi
  local ver
  ver=$(docker --version 2>&1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  if ! docker info &>/dev/null 2>&1; then
    fail "docker  $ver  (daemon not running — start Docker Desktop)"
    MISSING=1
  else
    ok "docker  $ver  (daemon running)"
  fi
}

# ── Run checks ─────────────────────────────────────────────────────────────────
log "Checking required tools..."
log ""

check_docker

log ""

# ── Summary ────────────────────────────────────────────────────────────────────
if [ "$MISSING" -eq 1 ]; then
  log "ERROR: docker is required. Install it, start the daemon, then re-run."
  exit 1
fi

log "All required tools present."
exit 0
