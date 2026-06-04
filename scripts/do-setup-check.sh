#!/usr/bin/env bash
# scripts/do-setup-check.sh
# Read-only state inspector for DigitalOcean first-time setup.
# Prints a ✓/✗ checklist of what is already done.
# Always exits 0 — it is a reporter, never a gate.
#
# Usage:
#   ./scripts/do-setup-check.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ok() { echo "  ✓ $*"; }
warn() { echo "  ✗ $*"; }
section() {
  echo ""
  echo "$*"
}

section "=== DigitalOcean Setup State Check ==="

# ── Prerequisites ─────────────────────────────────────────────────────────────
section "Prerequisites:"

DOCTL_OK=0
if command -v doctl &>/dev/null; then
  DOCTL_VER=$(doctl version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  ok "doctl ${DOCTL_VER}"
  DOCTL_OK=1
else
  warn "doctl not found  →  brew install doctl"
fi

DOCTL_AUTH_OK=0
if [ "$DOCTL_OK" -eq 1 ]; then
  if doctl auth list 2>/dev/null | grep -q "(current)"; then
    CONTEXT=$(doctl auth list 2>/dev/null | grep "(current)" | awk '{print $1}')
    ok "doctl authenticated (context: ${CONTEXT})"
    DOCTL_AUTH_OK=1
  else
    warn "doctl not authenticated  →  run: doctl auth init"
  fi
fi

GH_OK=0
if command -v gh &>/dev/null; then
  GH_VER=$(gh --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  ok "gh ${GH_VER}"
  GH_OK=1
else
  warn "gh not found  →  brew install gh"
fi

GH_AUTH_OK=0
if [ "$GH_OK" -eq 1 ]; then
  if gh auth status &>/dev/null 2>&1; then
    ok "gh authenticated"
    GH_AUTH_OK=1
  else
    warn "gh not authenticated  →  run: gh auth login"
  fi
fi

# ── DigitalOcean Resources ────────────────────────────────────────────────────
section "DigitalOcean Resources:"

APPS_FOUND=0
if [ "$DOCTL_AUTH_OK" -eq 1 ]; then
  APP_LIST=$(doctl apps list 2>/dev/null | grep -i "xstockstrat" || true)
  if [ -n "$APP_LIST" ]; then
    ok "Apps found:"
    echo "$APP_LIST" | awk '{printf "      %-45s id=%s\n", $2, $1}'
    APPS_FOUND=1
  else
    warn "No xstockstrat apps on DigitalOcean (run phases 4 and 5)"
  fi
else
  warn "Skipping app check — doctl not authenticated"
fi

DB_FOUND=0
if [ "$DOCTL_AUTH_OK" -eq 1 ]; then
  DB_LIST=$(doctl databases list 2>/dev/null | grep -i "xstockstrat" || true)
  if [ -n "$DB_LIST" ]; then
    ok "Database found:"
    echo "$DB_LIST" | awk '{printf "      %-45s status=%s\n", $2, $4}'
    DB_FOUND=1
  else
    warn "No xstockstrat database on DigitalOcean (run phase 2)"
  fi
else
  warn "Skipping database check — doctl not authenticated"
fi

# ── Repository ────────────────────────────────────────────────────────────────
section "Repository:"

GH_ORG=""
GH_ORG=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null |
  sed -E 's|.*github\.com[:/]([^/]+)/.*|\1|' || true)
if [ -n "$GH_ORG" ]; then
  ok "GitHub org: ${GH_ORG}"
else
  warn "Could not detect GitHub org from git remote"
fi

# ── GitHub Actions Secrets ────────────────────────────────────────────────────
section "GitHub Actions Secrets:"

REQUIRED_SECRETS=(DIGITALOCEAN_ACCESS_TOKEN DO_DEV_APP_ID DO_PROD_APP_ID BUF_TOKEN)

if [ "$GH_AUTH_OK" -eq 1 ]; then
  SECRET_LIST=$(gh secret list 2>/dev/null || true)
  MISSING_SECRETS=()
  for secret in "${REQUIRED_SECRETS[@]}"; do
    if echo "$SECRET_LIST" | grep -q "^${secret}"; then
      ok "${secret}"
    else
      warn "${secret} not set"
      MISSING_SECRETS+=("$secret")
    fi
  done
  if [ ${#MISSING_SECRETS[@]} -eq 0 ]; then
    echo ""
    echo "  All 4 required GitHub secrets are configured."
  fi
else
  warn "Skipping secret check — gh not authenticated"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "Next recommended action:"
if [ "$DOCTL_OK" -eq 0 ] || [ "$DOCTL_AUTH_OK" -eq 0 ]; then
  echo "  → Phase 1: Install and authenticate doctl"
elif [ "$DB_FOUND" -eq 0 ]; then
  echo "  → Phase 2: Create managed PostgreSQL database"
elif [ "$APPS_FOUND" -eq 0 ]; then
  echo "  → Phase 4: Create dev and prod apps on DigitalOcean"
elif [ "${#MISSING_SECRETS[@]}" -gt 0 ]; then
  echo "  → Phase 8: Configure GitHub Actions secrets"
else
  echo "  → Phase 9: Verify first deployment"
fi

echo ""
exit 0
