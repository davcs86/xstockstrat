#!/usr/bin/env bash
# scripts/migration-rerun.sh — CI-only (job: migration-rerun). Requires DATABASE_URL and SEED_USER_ID.
# Applies every migration, then replays the whole chain from version 0 (the db-migrate.sh dirty-state
# recovery path), so every up-file must be idempotent on the already-migrated schema.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SEED_USER_ID:?SEED_USER_ID is required}"

SCHEMAS="config ledger identity marketdata trading portfolio notify ingest indicators analysis"

count_n1_triggers() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c \
    "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%_n1_owner_fill%';"
}

echo "==> pass 1: db-migrate.sh up"
"$REPO_ROOT/scripts/db-migrate.sh" up
triggers_1="$(count_n1_triggers)"

echo "==> pass 2: force every service to version 0 and replay the chain"
for schema in $SCHEMAS; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "UPDATE public.${schema}_schema_migrations SET version = 0, dirty = true;" 2>/dev/null || true
done
"$REPO_ROOT/scripts/db-migrate.sh" up
triggers_2="$(count_n1_triggers)"

if [ "$triggers_1" != "$triggers_2" ]; then
  echo "migration-rerun: N-1 owner-fill trigger count changed across replay ($triggers_1 -> $triggers_2)" >&2
  exit 1
fi

assertions="$REPO_ROOT/scripts/migration-assertions"
if [ -d "$assertions" ]; then
  for sql in "$assertions"/*.sql; do
    [ -e "$sql" ] || continue
    echo "==> assertion: $(basename "$sql")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$sql"
  done
fi

echo "==> migration-rerun: OK (replay idempotent, N-1 trigger count stable at $triggers_2)"
