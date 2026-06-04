#!/usr/bin/env bash
# scripts/bootstrap.sh
# Sets up local development environment for xstockstrat.
# Hard requirement: docker (with daemon running). Services run in Docker.
# Optional: go/python3/node/pnpm — if present, host deps are installed for local test/lint runs.
# Run once after cloning: ./scripts/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "======================================================"
echo " xstockstrat Bootstrap"
echo "======================================================"

# ── 0. Setup .env if needed (local dev only, skip in CI) ──────────────────
echo ""
if [ -z "${CI:-}" ] && [ -z "${GITHUB_ACTIONS:-}" ]; then
  # Local development environment
  if [ ! -f "$REPO_ROOT/.env" ]; then
    echo "==> .env file not found. Starting interactive setup..."
    "$REPO_ROOT/scripts/setup-env.sh"
  else
    echo "==> .env file exists — skipping setup."
    echo "    (To reconfigure: rm .env && ./scripts/setup-env.sh)"
  fi
else
  # CI environment — skip .env setup (secrets injected via GitHub Actions)
  echo "==> CI environment detected — skipping .env setup."
  echo "    (Secrets are injected via GitHub Actions environment variables)"
fi

# ── 1. Check required tools ────────────────────────────────────────────────
echo ""
echo "==> Checking required tools..."
"$REPO_ROOT/scripts/check-prereqs.sh"

# ── 1.5. Check/enforce Node.js version ─────────────────────────────────────
echo ""
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ne 22 ]; then
    echo "⚠️  Node.js version is $NODE_VERSION (expected 22.x)"
    echo ""
    echo "   Options:"
    echo "   1. Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "      Then: nvm use 22"
    echo "   2. Install Node 22 via Homebrew: brew install node@22"
    echo ""
    exit 1
  else
    echo "==> Node.js $NODE_VERSION ✓"
  fi
else
  echo "==> Node.js not found — skipping version check."
  echo "    Install: brew install node@22  or  nvm install 22"
fi

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
  echo "    Install pnpm: brew install pnpm"
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
    (cd "$REPO_ROOT/packages/proto/gen/python" && python3 -m pip install -q -e .)
  fi
else
  echo "==> python3 not found — skipping Python dep install."
  echo "    Install Python: brew install python@3.12"
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
