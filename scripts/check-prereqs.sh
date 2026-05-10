#!/usr/bin/env bash
# scripts/check-prereqs.sh
# Checks all tools required to build and run xstockstrat-orchestration locally.
# Exits 0 if all required tools are present; exits 1 if any are missing.
# Version mismatches (wrong major version) produce a warning but do not block.
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

# ── Required versions (major.minor) ───────────────────────────────────────────
# Keep in sync with CLAUDE.md §Language Versions & Tooling
REQUIRED_GO="1.25"
REQUIRED_PYTHON="3.12"
REQUIRED_NODE="22"
REQUIRED_PNPM="9.15.0"

# ── Helpers ────────────────────────────────────────────────────────────────────

# Returns the first two version components (major.minor) from a version string.
major_minor() { echo "$1" | grep -oE '[0-9]+\.[0-9]+' | head -1; }

# Returns the major version component only.
major() { echo "$1" | grep -oE '^[0-9]+' | head -1; }

MISSING=0
MISMATCH=0

check() {
  local cmd="$1"
  local required="$2"   # empty string = any version accepted
  local install="$3"
  local ver_cmd="${4:-$cmd --version}"  # optional override for version command

  if ! command -v "$cmd" &>/dev/null; then
    fail "$cmd not found  →  $install"
    MISSING=1
    return
  fi

  local raw_ver
  raw_ver=$(eval "$ver_cmd" 2>&1 | head -1)
  local ver
  ver=$(echo "$raw_ver" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)

  if [ -z "$required" ]; then
    ok "$cmd  $ver"
    return
  fi

  local req_major
  req_major=$(major "$required")
  local inst_major
  inst_major=$(major "$ver")

  if [ "$inst_major" = "$req_major" ]; then
    ok "$cmd  $ver  (required: $required)"
  else
    warn "$cmd  $ver  (required: $required)  — version mismatch, may cause subtle failures"
    MISMATCH=1
  fi
}

# ── Check Docker daemon separately (presence ≠ daemon running) ────────────────
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

check "go"      "$REQUIRED_GO"    "https://go.dev/dl/"                                   "go version"
check "python3" "$REQUIRED_PYTHON" "https://www.python.org/downloads/"                   "python3 --version"
check "node"    "$REQUIRED_NODE"  "https://nodejs.org/"                                  "node --version"
check "pnpm"    "$REQUIRED_PNPM"  "npm install -g pnpm@${REQUIRED_PNPM}"                 "pnpm --version"
check "buf"     ""                "https://buf.build/docs/installation"
check "migrate" ""                "go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest"
check "psql"    ""                "https://www.postgresql.org/download/"                 "psql --version"
check_docker

log ""

# ── Summary ────────────────────────────────────────────────────────────────────
if [ "$MISSING" -eq 1 ]; then
  log "ERROR: one or more required tools are missing. Install them and re-run."
  exit 1
fi

if [ "$MISMATCH" -eq 1 ]; then
  log "WARNING: version mismatches detected. Builds may behave differently than CI."
fi

log "All required tools present."
exit 0
