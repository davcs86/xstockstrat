#!/usr/bin/env bash
# scripts/bootstrap.sh
# Sets up local development environment for xstockstrat-orchestration.
# Hard requirement: docker (with daemon running). Services run in Docker.
# Optional: go/python3/node/pnpm — if present, host deps are installed for local test/lint runs.
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

# ── 3. Install Node.js deps (if pnpm is available) ────────────────────────
echo ""
if command -v pnpm &>/dev/null; then
  echo "==> Installing Node.js dependencies (for local test/lint)..."
  for svc in xstockstrat-ledger xstockstrat-identity xstockstrat-notify xstockstrat-config \
              xstockstrat-trader xstockstrat-insights xstockstrat-config-ui; do
    echo "  → $svc"
    (cd "$REPO_ROOT/services/$svc" && pnpm install --frozen-lockfile)
  done
else
  echo "==> pnpm not found — skipping Node.js dep install."
  echo "    Install pnpm@${REQUIRED_PNPM:-9.15.0} to run Node.js tests and linters locally."
fi

# ── 4. Install Python deps (if python3 is available) ──────────────────────
echo ""
if command -v python3 &>/dev/null; then
  echo "==> Installing Python dependencies (for local test/lint)..."
  for svc in xstockstrat-indicators xstockstrat-ingest xstockstrat-analysis; do
    echo "  → $svc"
    if [ -f "$REPO_ROOT/services/$svc/requirements.txt" ]; then
      (cd "$REPO_ROOT/services/$svc" && python3 -m pip install -q -r requirements.txt)
    fi
  done
  if [ -f "$REPO_ROOT/packages/proto/gen/python/setup.py" ]; then
    echo "  → packages/proto/gen/python (editable install)"
    (cd "$REPO_ROOT/packages/proto/gen/python" && pip install -q -e .)
  fi
else
  echo "==> python3 not found — skipping Python dep install."
  echo "    Install Python 3.12 to run Python tests and linters locally."
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
