#!/usr/bin/env bash
# scripts/migration-rerun.sh — CI-only (job: migration-rerun). Requires DATABASE_URL and SEED_USER_ID.
# Replays the 224 expand + 225 contract up-files over fixtures (each must be idempotent), then proves the
# contract downs are refused and the db-migrate.sh dirty guard blocks `force 0` above the contract floor.
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
  analysis)
    migrate -path "$rendered" -database "$url" goto 25
    analysis_rendered="$rendered"
    ;;
  *) migrate -path "$rendered" -database "$url" up ;;
  esac
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$assertions/fixtures-pre-224.sql"
migrate -path "$analysis_rendered" -database "$(service_db_url analysis)" goto 26
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$assertions/fixtures-post-224.sql"

echo "==> pass 1: db-migrate.sh up"
"$REPO_ROOT/scripts/db-migrate.sh" up
triggers_1="$(count_n1_triggers)"

# Pre-224 up-files are not idempotent (docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md)
# and applied migrations are immutable (F-01), so only the 224 expand and 225 contract up-files are replayed.
echo "==> pass 2: re-apply the feature-224/225 up-files on the migrated schema"
replay="$(mktemp -d)"
for pair in indicators:007_private_formulas_templates ingest:013_signal_ownership_templates \
  ingest:014_contract_signal_ownership analysis:026_owner_dimension_templates \
  analysis:027_contract_owner_dimension; do
  schema="${pair%%:*}"
  file="${pair#*:}.up.sql"
  src="$(mktemp -d)"
  cp "$REPO_ROOT/services/xstockstrat-$schema/migrations/$file" "$src/"
  "$REPO_ROOT/scripts/render-migrations.sh" "$src" "$replay"
  echo "  → replay $schema/$file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$replay/$file"
done
triggers_2="$(count_n1_triggers)"

if [ "$triggers_1" != "0" ] || [ "$triggers_2" != "0" ]; then
  echo "migration-rerun: expected 0 N-1 owner-fill triggers after the contract (got $triggers_1 -> $triggers_2)" >&2
  exit 1
fi

echo "==> pass 3: contract downs are refused and the dirty guard blocks force 0"
out="$(mktemp)"
mig_version() {
  migrate -path "$REPO_ROOT/services/xstockstrat-$1/migrations" -database "$(service_db_url "$1")" version 2>&1 || true
}
sql_value() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }
must_contain() {
  if ! grep -qF -- "$1" "$out"; then
    echo "migration-rerun: $2: output lacks '$1':" >&2
    cat "$out" >&2
    exit 1
  fi
}
must_be_dirty() {
  case "$(mig_version "$1")" in
  "$2 (dirty)"*) ;;
  *)
    echo "migration-rerun: $1 should be dirty at $2, got: $(mig_version "$1")" >&2
    exit 1
    ;;
  esac
}

# refuse_down <schema> <goto version> <contract NNN>: the contract down raises and leaves the state dirty.
refuse_down() {
  echo "  → $1: goto $2 must be refused by $3.down"
  if migrate -path "$REPO_ROOT/services/xstockstrat-$1/migrations" -database "$(service_db_url "$1")" \
    goto "$2" >"$out" 2>&1; then
    echo "migration-rerun: $1 goto $2 unexpectedly succeeded" >&2
    exit 1
  fi
  must_contain "irreversible contract" "$1 $3 down"
  must_be_dirty "$1" "$2"
}
# guard_blocks <schema> <dirty version> <recover version>: db-migrate.sh up refuses force 0, then recover.
guard_blocks() {
  echo "  → $1: db-migrate.sh up must refuse force 0 while dirty at $2"
  if "$REPO_ROOT/scripts/db-migrate.sh" up >"$out" 2>&1; then
    echo "migration-rerun: db-migrate.sh up unexpectedly succeeded with $1 dirty at $2" >&2
    exit 1
  fi
  must_contain "$1 is dirty at version $2" "dirty guard"
  must_contain "force $3" "dirty guard"
  must_be_dirty "$1" "$2"
  migrate -path "$REPO_ROOT/services/xstockstrat-$1/migrations" -database "$(service_db_url "$1")" force "$3"
}

refuse_down ingest 13 014
if [ "$(sql_value "SELECT to_regclass('ingest.signal_dedup_keys') IS NULL;")" != "t" ]; then
  echo "migration-rerun: AC-13: ingest.signal_dedup_keys re-appeared after the refused down" >&2
  exit 1
fi
guard_blocks ingest 13 12

refuse_down analysis 26 027
if [ "$(sql_value "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'analysis'
    AND table_name = 'backtest_runs' AND column_name = 'user_id';")" != "NO" ]; then
  echo "migration-rerun: AC-6: analysis.backtest_runs.user_id is nullable after the refused down" >&2
  exit 1
fi
guard_blocks analysis 26 25

echo "  → recovery: db-migrate.sh up replays the contract and ends clean"
"$REPO_ROOT/scripts/db-migrate.sh" up
for want in ingest:14 analysis:27; do
  got="$(mig_version "${want%%:*}")"
  if [ "$got" != "${want#*:}" ]; then
    echo "migration-rerun: ${want%%:*} should be clean at ${want#*:}, got: $got" >&2
    exit 1
  fi
done

for sql in "$assertions"/*.sql; do
  [ -e "$sql" ] || continue
  case "$(basename "$sql")" in
  fixtures-*) continue ;;
  esac
  echo "==> assertion: $(basename "$sql")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v seed_user_id="$SEED_USER_ID" -f "$sql"
done

echo "==> migration-rerun: OK (replay idempotent, contract downs refused, dirty guard enforced)"
