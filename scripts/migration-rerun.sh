#!/usr/bin/env bash
# scripts/migration-rerun.sh — CI-only (job: migration-rerun). Requires DATABASE_URL and SEED_USER_ID.
# Migrates to the pre-224 versions, loads fixtures-pre-224.sql, applies the rest, then re-applies the
# feature-224 up-files a second time: each must be idempotent on the already-migrated schema.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SEED_USER_ID:?SEED_USER_ID is required}"

SCHEMAS="config ledger identity marketdata trading portfolio notify ingest indicators analysis"
assertions="$REPO_ROOT/scripts/migration-assertions"

count_n1_triggers() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
    "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%_n1_owner_fill%';"
}

# Same x-migrations-table rule as db-migrate.sh service_db_url.
service_db_url() {
  case "$DATABASE_URL" in
  *\?*) echo "${DATABASE_URL}&x-migrations-table=$1_schema_migrations" ;;
  *) echo "${DATABASE_URL}?x-migrations-table=$1_schema_migrations" ;;
  esac
}

echo "==> pass 0: migrate to the pre-224 versions and load fixtures"
# `goto` on an already-migrated database would run down-files, so pass 0 needs a fresh one.
fresh="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
  "SELECT to_regclass('public.indicators_schema_migrations') IS NULL;")"
if [ "$fresh" != "t" ]; then
  echo "migration-rerun: expects a fresh database (indicators_schema_migrations already exists)" >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
for schema in $SCHEMAS; do
  dir="$REPO_ROOT/services/xstockstrat-$schema/migrations"
  [ -d "$dir" ] || continue
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS ${schema};"
  if [ "$schema" = "analysis" ]; then
    # Mirrors the db-migrate.sh `up` analysis-013 render (single-variable envsubst allowlist).
    seeded="$(mktemp -d)"
    cp "$dir"/*.sql "$seeded"/
    # shellcheck disable=SC2016
    envsubst '$SEED_USER_ID' <"$dir/013_strategies_user_id.up.sql" >"$seeded/013_strategies_user_id.up.sql"
    dir="$seeded"
  fi
  rendered="$(mktemp -d)"
  "$REPO_ROOT/scripts/render-migrations.sh" "$dir" "$rendered"
  url="$(service_db_url "$schema")"
  echo "  → $schema"
  case "$schema" in
  indicators) migrate -path "$rendered" -database "$url" goto 6 ;;
  ingest) migrate -path "$rendered" -database "$url" goto 12 ;;
  analysis) migrate -path "$rendered" -database "$url" goto 25 ;;
  *) migrate -path "$rendered" -database "$url" up ;;
  esac
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$assertions/fixtures-pre-224.sql"

echo "==> pass 1: db-migrate.sh up"
"$REPO_ROOT/scripts/db-migrate.sh" up
triggers_1="$(count_n1_triggers)"

# Pre-224 up-files are not idempotent (docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md)
# and applied migrations are immutable (F-01), so only the feature-224 up-files are replayed.
echo "==> pass 2: re-apply the feature-224 up-files on the migrated schema"
replay="$(mktemp -d)"
for pair in indicators:007_private_formulas_templates ingest:013_signal_ownership_templates \
  analysis:026_owner_dimension_templates; do
  schema="${pair%%:*}"
  file="${pair#*:}.up.sql"
  src="$(mktemp -d)"
  cp "$REPO_ROOT/services/xstockstrat-$schema/migrations/$file" "$src/"
  "$REPO_ROOT/scripts/render-migrations.sh" "$src" "$replay"
  echo "  → replay $schema/$file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$replay/$file"
done
triggers_2="$(count_n1_triggers)"

if [ "$triggers_1" != "$triggers_2" ]; then
  echo "migration-rerun: N-1 owner-fill trigger count changed across replay ($triggers_1 -> $triggers_2)" >&2
  exit 1
fi

for sql in "$assertions"/*.sql; do
  [ -e "$sql" ] || continue
  case "$(basename "$sql")" in
  fixtures-*) continue ;;
  esac
  echo "==> assertion: $(basename "$sql")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v seed_user_id="$SEED_USER_ID" -f "$sql"
done

echo "==> migration-rerun: OK (replay idempotent, N-1 trigger count stable at $triggers_2)"
