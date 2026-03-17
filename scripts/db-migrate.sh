#!/usr/bin/env bash
# scripts/db-migrate.sh
# Runs all service migrations in dependency order against TimescaleDB.
# Requires: psql in PATH, DATABASE_URL set or default used.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${DATABASE_URL:-postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable}"

run_migrations() {
  local svc="$1"
  local dir="$REPO_ROOT/services/$svc/migrations"
  if [ ! -d "$dir" ]; then
    echo "  [skip] $svc — no migrations dir"
    return
  fi
  echo "  → $svc"
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    echo "    applying $(basename "$f")..."
    psql "$DB_URL" -f "$f" --quiet
  done
}

echo "==> Running migrations (dependency order)..."
echo ""

# 1. Config first — all services depend on it
run_migrations "xstockstrat-config"

# 2. Ledger — all services write here
run_migrations "xstockstrat-ledger"

# 3. Identity — auth dependency
run_migrations "xstockstrat-identity"

# 4. MarketData — trading and analysis depend on it
run_migrations "xstockstrat-marketdata"

# 5. Trading
run_migrations "xstockstrat-trading"

# 6. Portfolio
run_migrations "xstockstrat-portfolio"

# 7. Notify
run_migrations "xstockstrat-notify"

# 8. Python services (Alembic or raw SQL)
run_migrations "xstockstrat-indicators"
run_migrations "xstockstrat-ingest"
run_migrations "xstockstrat-analysis"

echo ""
echo "==> All migrations applied."
echo ""

# Verify hypertables
echo "==> Verifying TimescaleDB hypertables..."
psql "$DB_URL" -t -c "
SELECT hypertable_schema || '.' || hypertable_name AS hypertable
FROM timescaledb_information.hypertables
ORDER BY 1;
"
