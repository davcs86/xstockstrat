#!/usr/bin/env bash
# scripts/config-heal-dryrun.sh --fresh | --staging <inventory.jsonl> [--reveal <reveal.jsonl>]
# Needs DATABASE_URL (creates and drops a scratch DB), psql, migrate. Prints no URL and no value.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_REL="services/xstockstrat-config/migrations"
HEAL_DIR="$REPO_ROOT/scripts/config-heal"

usage() {
  echo "usage: $0 --fresh | --staging <inventory.jsonl> [--reveal <reveal.jsonl>]" >&2
  exit 2
}

mode=""
inventory=""
reveal=""
while [ "$#" -gt 0 ]; do
  case "$1" in
  --fresh) mode=fresh ;;
  --staging)
    [ "$#" -ge 2 ] || usage
    mode=staging
    inventory="$2"
    shift
    ;;
  --reveal)
    [ "$#" -ge 2 ] || usage
    reveal="$2"
    shift
    ;;
  *) usage ;;
  esac
  shift
done
[ -n "$mode" ] || usage
if [ "$mode" = staging ]; then
  [ -f "$inventory" ] || {
    echo "config-heal-dryrun: inventory not found: $inventory" >&2
    exit 2
  }
  [ -z "$reveal" ] || [ -f "$reveal" ] || {
    echo "config-heal-dryrun: reveal file not found: $reveal" >&2
    exit 2
  }
elif [ -n "$reveal" ]; then
  usage
fi
: "${DATABASE_URL:?DATABASE_URL is required}"

redact() { sed -E 's#postgres(ql)?://[^[:space:]]*#<url>#g'; }

base="${DATABASE_URL%%\?*}"
qs=""
case "$DATABASE_URL" in *\?*) qs="${DATABASE_URL#*\?}" ;; esac
scratch="cfgheal_dryrun_$$"
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

sql() { psql "$scratch_url" -q -v ON_ERROR_STOP=1 "$@" 2>&1 | redact; }
migrate_to() { migrate -path "$work/mig" -database "$migrate_url" goto "$1" 2>&1 | redact; }

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${scratch};" 2>&1 | redact
"$REPO_ROOT/scripts/render-migrations.sh" "$REPO_ROOT/$MIG_REL" "$work/mig"
# Test-only allowlist tuples (Step 32) must never sign a dry-run deletion.
for f in "$work/mig"/041_*.up.sql; do
  grep -v -e '-- fixture[[:space:]]*$' "$f" >"$work/041.tmp" || true
  mv "$work/041.tmp" "$f"
done
sql -c "CREATE SCHEMA IF NOT EXISTS config; CREATE SCHEMA heal_dry;"
echo "config-heal-dryrun: migrating config to 40"
migrate_to 40

if [ "$mode" = fresh ]; then
  # Same explicit column list as ROWS_SQL in services/xstockstrat-indicators/app/maintenance/config_inventory.py.
  psql "$scratch_url" -q -At -v ON_ERROR_STOP=1 -c \
    "SELECT namespace, key, environment, user_id, value_type, is_secret,
            CASE WHEN is_secret THEN NULL ELSE value_data END AS value_data,
            CASE WHEN is_secret THEN NULL ELSE default_value END AS default_value,
            description, consuming_service, updated_at
     FROM config.config_values ORDER BY namespace, key, environment, user_id" >"$work/inventory.txt"
  echo "config-heal-dryrun: inventory at 40 holds $(wc -l <"$work/inventory.txt" | tr -d ' ') rows"
  out="$HEAL_DIR/dryrun-fresh.tsv"
  user_hashed=no
else
  sql -c "DELETE FROM config.config_values;
          CREATE TABLE heal_dry.raw_inv (line text);
          CREATE TABLE heal_dry.raw_rev (line text);
          CREATE TABLE heal_dry.catalog (namespace text, key text, match text, value_type text,
            code_default text, description text, consuming_service text, is_secret boolean, reader text,
            readers_disagree boolean);"
  lines="WITH (FORMAT csv, DELIMITER E'\\x02', QUOTE E'\\x01')"
  sql -c "COPY heal_dry.raw_inv FROM STDIN $lines" <"$inventory"
  [ -z "$reveal" ] || sql -c "COPY heal_dry.raw_rev FROM STDIN $lines" <"$reveal"
  sql -c "COPY heal_dry.catalog FROM STDIN WITH (FORMAT csv, HEADER true, DELIMITER E'\\t', QUOTE E'\\x01')" \
    <"$HEAL_DIR/catalog.tsv"
  sql <<'SQL'
CREATE TABLE heal_dry.loaded AS
WITH inv AS (
  SELECT j->>'namespace' AS ns, j->>'key' AS k, j->>'environment' AS env, j->>'user_sha256' AS usr,
         j->>'value_type' AS vt, (j->>'is_secret')::boolean AS sec, j->>'value_sha256' AS vh
  FROM (SELECT line::jsonb AS j FROM heal_dry.raw_inv WHERE line LIKE '{%') s
), rev AS (
  SELECT j->>'namespace' AS ns, j->>'key' AS k, j->>'environment' AS env, j->>'value' AS val
  FROM (SELECT line::jsonb AS j FROM heal_dry.raw_rev WHERE line LIKE '{%') s
  WHERE j ? 'value' AND j->>'user_sha256' IS NULL
), bounds(ns, rel, lo, hi) AS (
  VALUES ('indicators', 'sandbox.startup_grace_ms', 1000, 10000),
         ('indicators', 'sandbox.timeout_ms', 100, 33000),
         ('analysis', 'compute.max_worker_threads', 1, 16)
), v AS (
  SELECT i.*, r.val, c.code_default, c.description, c.consuming_service, b.lo,
         CASE WHEN b.lo::text = c.code_default THEN b.lo + 1 ELSE b.lo END AS synth
  FROM inv i
  LEFT JOIN rev r ON r.ns = i.ns AND r.k = i.k AND r.env = i.env AND i.usr IS NULL
  LEFT JOIN heal_dry.catalog c ON c.namespace = i.ns AND c.key = i.k AND c.match = 'exact'
  LEFT JOIN bounds b ON b.ns = i.ns AND i.k IN (b.rel, b.ns || '.' || b.rel)
)
SELECT ns, k, env, usr, vt, sec, description, consuming_service,
       CASE WHEN sec THEN NULL ELSE code_default END AS default_value,
       CASE WHEN val IS NOT NULL THEN 'revealed'
            WHEN code_default IS NOT NULL
             AND vh = encode(sha256(convert_to(code_default, 'UTF8')), 'hex') THEN 'default'
            WHEN vh IS NULL THEN 'sentinel'
            WHEN lo IS NOT NULL THEN 'synthesized'
            ELSE 'sentinel' END AS origin,
       CASE WHEN val IS NOT NULL THEN val
            WHEN code_default IS NOT NULL
             AND vh = encode(sha256(convert_to(code_default, 'UTF8')), 'hex') THEN code_default
            WHEN vh IS NULL THEN '__secret_class__'
            WHEN lo IS NOT NULL THEN synth::text
            ELSE '__sha256:' || vh END AS val
FROM v;

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
   environment, user_id, updated_by)
SELECT ns, k, vt, val, sec, description, default_value, consuming_service, env, usr, 'config-heal-dryrun'
FROM heal_dry.loaded;
SQL
  echo "config-heal-dryrun: loaded $(psql "$scratch_url" -At -c 'SELECT count(*) FROM heal_dry.loaded' 2>&1 | redact) inventory rows"
  out="$HEAL_DIR/dryrun-staging.tsv"
  user_hashed=yes
fi

echo "config-heal-dryrun: applying 041"
migrate_to 41

# Values never leave the DB: stored/effective columns are dropped and the default-synced reason is reworded.
psql "$scratch_url" -q -At -F "$(printf '\t')" -v ON_ERROR_STOP=1 -v hashed="$user_hashed" >"$work/rows.tsv" <<'SQL'
SELECT action, COALESCE(namespace, ''), COALESCE(key, ''), COALESCE(environment, ''),
       CASE WHEN user_id IS NULL THEN ''
            WHEN :'hashed' = 'yes' THEN user_id
            ELSE encode(sha256(convert_to(user_id, 'UTF8')), 'hex') END,
       CASE WHEN action = 'default-synced'
            THEN 'default_value synced to the reader code default; value_data unchanged'
            ELSE COALESCE(reason, '') END
FROM config.config_heal_report_041
WHERE action <> 'latch';
SQL
{
  printf 'action\tnamespace\tkey\tenvironment\tuser_sha256\treason\n'
  LC_ALL=C sort "$work/rows.tsv"
} >"$work/out.tsv"
mv "$work/out.tsv" "$out"
echo "config-heal-dryrun: wrote ${out#"$REPO_ROOT"/} ($(wc -l <"$work/rows.tsv" | tr -d ' ') rows)"

if [ "$mode" = staging ]; then
  psql "$scratch_url" -q -At -F "$(printf '\t')" -v ON_ERROR_STOP=1 >"$work/bad.tsv" <<'SQL'
SELECT r.action, r.namespace, r.key, r.environment, l.origin
FROM config.config_heal_report_041 r
JOIN heal_dry.loaded l
  ON l.ns = r.namespace AND l.k = r.key AND l.env = r.environment
 AND COALESCE(l.usr, '') = COALESCE(r.user_id, '')
WHERE r.action IN ('twin-deleted', 'retyped', 'default-synced')
  AND l.origin IN ('sentinel', 'synthesized')
ORDER BY 1, 2, 3, 4;
SQL
  if [ -s "$work/bad.tsv" ]; then
    echo "config-heal-dryrun: a content decision touched a sentinel or synthesized row:" >&2
    cat "$work/bad.tsv" >&2
    exit 1
  fi
fi
