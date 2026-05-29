#!/usr/bin/env bash
# scripts/check-prereqs.sh
# Checks tools required to work with xstockstrat locally.
#
# Hard requirement (exits 1 if missing):
#   docker — services, proto codegen, and migrations all run in containers
#
# Soft requirements for local tests and linters (warns if missing, never blocks):
#   go + golangci-lint — Go services (trading, portfolio, marketdata)
#   python3            — Python services (indicators, ingest, analysis)
#   node + pnpm        — Node.js + Next.js services (ledger, identity, notify, config, trader, insights, config-ui)
#
# NOT required on the host (provided by Docker containers):
#   buf        — proto codegen runs inside Dockerfile.codegen via localenv-setup.sh
#   migrate    — migrations run inside scripts/Dockerfile.migrate via docker-compose
#   psql       — available inside the migrate container
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
warn() { log "  ⚠ $*"; }
fail() { log "  ✗ $*"; }

# Keep in sync with CLAUDE.md §Language Versions & Tooling
REQUIRED_GO="1.25"
REQUIRED_GOLANGCI="2.5.0"
REQUIRED_PYTHON="3.12"
REQUIRED_NODE="22"
REQUIRED_PNPM="9.15.0"

major() { echo "$1" | grep -oE '^[0-9]+' | head -1; }

MISSING=0       # hard — exits 1
MISSING_SOFT=0  # soft — warns only

# ── Hard: docker ──────────────────────────────────────────────────────────────
check_docker() {
  if ! command -v docker &>/dev/null; then
    fail "docker not found  →  brew install --cask docker"
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

# ── Soft: language toolchains ─────────────────────────────────────────────────
# Warns if missing or wrong major version, never sets MISSING.
check_soft() {
  local cmd="$1"
  local required="$2"
  local install="$3"
  local ver_cmd="${4:-$cmd --version}"

  if ! command -v "$cmd" &>/dev/null; then
    warn "$cmd not found  →  $install"
    MISSING_SOFT=1
    return
  fi

  local ver
  ver=$(eval "$ver_cmd" 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)

  local req_major inst_major
  req_major=$(major "$required")
  inst_major=$(major "$ver")

  if [ "$inst_major" = "$req_major" ]; then
    ok "$cmd  $ver  (required: $required)"
  else
    warn "$cmd  $ver  (required: $required)  — version mismatch"
    MISSING_SOFT=1
  fi
}

# ── Run checks ─────────────────────────────────────────────────────────────────
log "Checking required tools..."
log ""
check_docker

log ""
log "Checking language toolchains (needed for local tests and linters)..."
log ""
check_soft "go"            "$REQUIRED_GO"       "brew install go"                 "go version"
check_soft "golangci-lint" "$REQUIRED_GOLANGCI" "brew install golangci-lint"       "golangci-lint --version"
check_soft "python3"       "$REQUIRED_PYTHON"   "brew install python@3.12"         "python3 --version"
check_soft "node"          "$REQUIRED_NODE"     "brew install node@22"             "node --version"
check_soft "pnpm"          "$REQUIRED_PNPM"     "brew install pnpm"                "pnpm --version"

log ""

# ── Summary ────────────────────────────────────────────────────────────────────
if [ "$MISSING" -eq 1 ]; then
  log "ERROR: docker is required. Install it, start the daemon, then re-run."
  exit 1
fi

if [ "$MISSING_SOFT" -eq 1 ]; then
  log "WARNING: some language toolchains are missing or mismatched."
  log "         Local test and lint runs for those languages will not work."
  log "         Services run in Docker and are unaffected."
fi

log "All required tools present."
exit 0
