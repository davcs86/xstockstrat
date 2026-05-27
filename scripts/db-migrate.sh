#!/usr/bin/env bash
# scripts/db-migrate.sh
# Runs all service migrations in dependency order against TimescaleDB.
# Intended to run inside the db-migrator Docker container (postgres:16-alpine base),
# which provides both migrate (golang-migrate v4.17.1) and psql.
# DATABASE_URL is set via docker-compose environment or defaults to localhost.
#
# Usage:
#   ./scripts/db-migrate.sh              # apply all pending migrations
#   ./scripts/db-migrate.sh version      # show current version per service
#
# Migration state is tracked in schema_migrations table inside each service's schema.
# On a database that was already bootstrapped with the old bare-psql approach, run:
#   ./scripts/db-migrate.sh force        # seed version state without re-applying SQL

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required. Set it in .env or export it before running this script."
  echo "  Example: export DATABASE_URL=postgres://xstockstrat:<password>@localhost:5432/xstockstrat?sslmode=disable"
  exit 1
fi
DB_URL="${DATABASE_URL}"
COMMAND="${1:-up}"

# Build a DATABASE_URL with schema-scoped migration tracking.
# Each service's schema_migrations table lives inside its own schema.
service_db_url() {
  local schema="$1"
  # Strip any existing query string and append migration params
  local base="${DB_URL%%\?*}"
  local qs="${DB_URL#*\?}"
  # If DB_URL had no query string, qs == DB_URL (no '?' found)
  if [ "$qs" = "$DB_URL" ]; then
    qs=""
  fi
  local extra="x-migrations-table=schema_migrations&search_path=${schema}"
  if [ -n "$qs" ]; then
    echo "${base}?${qs}&${extra}"
  else
    echo "${base}?${extra}"
  fi
}

migrate_service() {
  local svc="$1"
  local schema="$2"
  local dir="$REPO_ROOT/services/$svc/migrations"
  if [ ! -d "$dir" ]; then
    echo "  [skip] $svc — no migrations dir"
    return
  fi
  # Pre-create the schema so golang-migrate can write its schema_migrations state
  # table before migration 001 runs. Without this, search_path=<schema> fails on
  # a fresh database because the schema doesn't exist yet.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS ${schema};"
  local url
  url="$(service_db_url "$schema")"
  echo "  → $svc (schema: $schema)"
  case "$COMMAND" in
    up)
      migrate -path "$dir" -database "$url" up
      ;;
    version)
      local ver
      ver=$(migrate -path "$dir" -database "$url" version 2>&1 || true)
      echo "    version: $ver"
      ;;
    force)
      # Count .up.sql files to determine the highest version in this service
      local highest
      highest=$(ls "$dir"/*.up.sql 2>/dev/null | sed 's/.*\/\([0-9]*\)_.*/\1/' | sort -n | tail -1 | sed 's/^0*//')
      if [ -n "$highest" ]; then
        echo "    forcing version $highest"
        migrate -path "$dir" -database "$url" force "$highest"
      else
        echo "    [skip] no migrations found"
      fi
      ;;
    *)
      echo "  Unknown command: $COMMAND. Use: up | version | force"
      exit 1
      ;;
  esac
}

echo "==> Enabling TimescaleDB extension..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
echo ""

echo "==> Creating schemas (idempotent)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 << 'SQL'
CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS marketdata;
CREATE SCHEMA IF NOT EXISTS trading;
CREATE SCHEMA IF NOT EXISTS portfolio;
CREATE SCHEMA IF NOT EXISTS notify;
CREATE SCHEMA IF NOT EXISTS ingest;
CREATE SCHEMA IF NOT EXISTS indicators;
CREATE SCHEMA IF NOT EXISTS analysis;
SQL
echo ""

echo "==> Running migrations (command: $COMMAND, dependency order)..."
echo ""

# 1. Config first — all services depend on it
migrate_service "xstockstrat-config"     "config"

# 2. Ledger — all services write here
migrate_service "xstockstrat-ledger"     "ledger"

# 3. Identity — auth dependency
migrate_service "xstockstrat-identity"   "identity"

# 4. MarketData — trading and analysis depend on it
migrate_service "xstockstrat-marketdata" "marketdata"

# 5. Trading
migrate_service "xstockstrat-trading"    "trading"

# 6. Portfolio
migrate_service "xstockstrat-portfolio"  "portfolio"

# 7. Notify
migrate_service "xstockstrat-notify"     "notify"

# 8. Ingest (Python service, raw SQL migrations)
migrate_service "xstockstrat-ingest"     "ingest"

# indicators and analysis have no migrations dir yet
migrate_service "xstockstrat-indicators" "indicators"
migrate_service "xstockstrat-analysis"   "analysis"

echo ""
echo "==> All migrations complete (command: $COMMAND)."
echo ""

if [ "$COMMAND" = "up" ]; then
  echo "==> Verifying TimescaleDB hypertables..."
  psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
  SELECT hypertable_schema || '.' || hypertable_name AS hypertable
  FROM timescaledb_information.hypertables
  ORDER BY 1;
  "
fi
