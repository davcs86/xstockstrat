#!/usr/bin/env bash
# scripts/bootstrap.sh
# Sets up local development environment for xstockstrat-orchestration.
# Run once after cloning: ./scripts/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "======================================================"
echo " xstockstrat-orchestration Bootstrap"
echo "======================================================"

# ── 1. Check required tools ────────────────────────────────────────────────
echo ""
echo "==> Checking required tools..."

check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "  ✗ $1 not found. Install: $2"
    MISSING=1
  else
    echo "  ✓ $1 ($(${1} --version 2>&1 | head -1))"
  fi
}

MISSING=0
check_tool "buf"     "https://buf.build/docs/installation"
check_tool "go"      "https://go.dev/dl/"
check_tool "python3" "https://www.python.org/downloads/"
check_tool "node"    "https://nodejs.org/"
check_tool "pnpm"    "corepack enable or https://pnpm.io/installation"
check_tool "docker"  "https://docs.docker.com/get-docker/"
check_tool "psql"    "https://www.postgresql.org/download/"

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "ERROR: Please install missing tools above, then re-run."
  exit 1
fi

# ── 2. Generate proto stubs ────────────────────────────────────────────────
echo ""
echo "==> Generating proto stubs..."
"$REPO_ROOT/scripts/buf-gen.sh"

# ── 3. Install Node dependencies for Node.js services ─────────────────────
echo ""
echo "==> Installing Node.js dependencies..."
for svc in xstockstrat-ledger xstockstrat-identity xstockstrat-notify xstockstrat-config; do
  echo "  → $svc"
  (cd "$REPO_ROOT/services/$svc" && pnpm install --frozen-lockfile)
done

echo "==> Installing Next.js frontend dependencies..."
for svc in xstockstrat-trader xstockstrat-insights xstockstrat-config-ui; do
  echo "  → $svc"
  (cd "$REPO_ROOT/services/$svc" && pnpm install --frozen-lockfile)
done

# ── 4. Install Python dependencies ────────────────────────────────────────
echo ""
echo "==> Installing Python dependencies..."
for svc in xstockstrat-indicators xstockstrat-ingest xstockstrat-analysis; do
  echo "  → $svc"
  if [ -f "$REPO_ROOT/services/$svc/requirements.txt" ]; then
    (cd "$REPO_ROOT/services/$svc" && python3 -m pip install -q -r requirements.txt)
  fi
done

# Install generated Python stubs as editable
echo "  → packages/proto/gen/python (editable install)"
if [ -f "$REPO_ROOT/packages/proto/gen/python/setup.py" ]; then
  (cd "$REPO_ROOT/packages/proto/gen/python" && pip install -q -e .)
fi

# ── 5. Start local TimescaleDB ─────────────────────────────────────────────
echo ""
echo "==> Starting TimescaleDB via Docker..."
if ! docker ps --format '{{.Names}}' | grep -q "xstockstrat-db"; then
  docker run -d \
    --name xstockstrat-db \
    -e POSTGRES_USER=xstockstrat \
    -e POSTGRES_PASSWORD=devpassword \
    -e POSTGRES_DB=xstockstrat \
    -p 5432:5432 \
    timescale/timescaledb:latest-pg16
  echo "  Waiting for TimescaleDB to be ready..."
  sleep 5
  until docker exec xstockstrat-db pg_isready -U xstockstrat -q; do sleep 1; done
  echo "  ✓ TimescaleDB ready"
else
  echo "  ✓ xstockstrat-db already running"
fi

export DATABASE_URL="postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable"

# ── 6. Run all migrations ──────────────────────────────────────────────────
echo ""
echo "==> Running database migrations..."
"$REPO_ROOT/scripts/db-migrate.sh"

echo ""
echo "======================================================"
echo " Bootstrap complete!"
echo ""
echo " DATABASE_URL=$DATABASE_URL"
echo ""
echo " Start services individually or use docker-compose."
echo " See each service's CLAUDE.md for run instructions."
echo "======================================================"
