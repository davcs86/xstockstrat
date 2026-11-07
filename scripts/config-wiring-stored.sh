#!/usr/bin/env bash
# scripts/config-wiring-stored.sh [out.json]: needs DATABASE_URL (it creates and drops a scratch DB), psql, migrate.
# Never prints the URL or reads value_data; secret rows have default_value nulled.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT="${1:-$REPO_ROOT/scripts/config-wiring-stored.json}"
MIG_REL="services/xstockstrat-config/migrations"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# Same manifest as storedInputsSha256() in scripts/check-config-wiring.mjs.
inputs_sha256() {
  (
    cd "$REPO_ROOT"
    {
      find "$MIG_REL" -type f
      echo scripts/config-wiring-stored.sh
    } | LC_ALL=C sort | while IFS= read -r f; do sha "$f"; done
  ) | sha | cut -c1-64
}

redact() { sed -E 's#postgres(ql)?://[^[:space:]]*#<url>#g'; }

base="${DATABASE_URL%%\?*}"
qs=""
case "$DATABASE_URL" in *\?*) qs="${DATABASE_URL#*\?}" ;; esac
scratch="cfgwire_stored_$$"
scratch_url="${base%/*}/${scratch}"
if [ -n "$qs" ]; then
  migrate_url="${scratch_url}?${qs}&x-migrations-table=config_schema_migrations"
  scratch_url="${scratch_url}?${qs}"
else
  migrate_url="${scratch_url}?x-migrations-table=config_schema_migrations"
fi
work="$(mktemp -d)"

cleanup() {
  psql "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS ${scratch};" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${scratch};" 2>&1 | redact
"$REPO_ROOT/scripts/render-migrations.sh" "$REPO_ROOT/$MIG_REL" "$work/mig"
psql "$scratch_url" -q -v ON_ERROR_STOP=1 -c \
  "CREATE SCHEMA IF NOT EXISTS config; CREATE SCHEMA cfgwire_gen;
   CREATE TABLE cfgwire_gen.seen(id bigint PRIMARY KEY, file text NOT NULL);" 2>&1 | redact

# One migration at a time, so each row names the migration that inserted it.
for up in "$work/mig"/*.up.sql; do
  f="$(basename "$up")"
  echo "config-wiring-stored: applying $f"
  migrate -path "$work/mig" -database "$migrate_url" up 1 2>&1 | redact
  psql "$scratch_url" -q -v ON_ERROR_STOP=1 -v file="$f" <<'SQL' 2>&1 | redact
SELECT to_regclass('config.config_values') IS NOT NULL AS has_table \gset
\if :has_table
INSERT INTO cfgwire_gen.seen (id, file)
SELECT c.id, :'file' FROM config.config_values c
ON CONFLICT (id) DO NOTHING;
\endif
SQL
done

psql "$scratch_url" -q -At -v ON_ERROR_STOP=1 -v inputs="$(inputs_sha256)" >"$work/out.json" <<'SQL'
SELECT jsonb_pretty(jsonb_build_object(
  'inputs_sha256', :'inputs',
  'rows', COALESCE(jsonb_agg(to_jsonb(r) - 'ord' ORDER BY r.namespace COLLATE "C", r.key COLLATE "C",
    r.environment COLLATE "C", r.global DESC, r.ord COLLATE "C"), '[]'::jsonb)))
FROM (
  SELECT c.namespace, c.key, c.environment, c.user_id IS NULL AS global, c.is_secret, c.value_type,
         c.description, c.consuming_service,
         CASE WHEN c.is_secret THEN NULL ELSE c.default_value END AS default_value,
         s.file, md5(COALESCE(c.user_id, '')) AS ord
  FROM config.config_values c
  LEFT JOIN cfgwire_gen.seen s USING (id)
) r;
SQL
mv "$work/out.json" "$OUT"
echo "config-wiring-stored: wrote ${OUT#"$REPO_ROOT"/}"
