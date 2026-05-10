#!/usr/bin/env bash
# scripts/bootstrap.sh
# Sets up local development environment for xstockstrat-orchestration.
# Requires: docker (with daemon running). All services run in Docker — no host language toolchains needed.
# Run once after cloning: ./scripts/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "======================================================"
echo " xstockstrat-orchestration Bootstrap"
echo "======================================================"

# ── 1. Check required tools ────────────────────────────────────────────────
echo ""
echo "==> Checking required tools..."
"$REPO_ROOT/scripts/check-prereqs.sh"

# ── 2. Generate proto stubs ────────────────────────────────────────────────
echo ""
if [ -d "$REPO_ROOT/packages/proto/gen" ] && [ -n "$(ls -A "$REPO_ROOT/packages/proto/gen" 2>/dev/null)" ]; then
  echo "==> Proto stubs already present — skipping generation."
else
  echo "==> Proto stubs missing — running localenv-setup.sh (Docker required)..."
  "$REPO_ROOT/scripts/localenv-setup.sh"
fi

echo ""
echo "======================================================"
echo " Bootstrap complete!"
echo ""
echo " Next steps:"
echo ""
echo "   docker compose up -d"
echo ""
echo " docker-compose will:"
echo "   1. Start TimescaleDB (with health check)"
echo "   2. Run db-migrator (applies all pending migrations)"
echo "   3. Start all application services"
echo ""
echo " Logs:  docker compose logs -f"
echo " DB migration logs:  docker compose logs db-migrator --tail=50"
echo "======================================================"
