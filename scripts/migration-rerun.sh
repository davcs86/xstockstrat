#!/usr/bin/env bash
# scripts/migration-rerun.sh — CI-only (job: migration-rerun). Requires DATABASE_URL and SEED_USER_ID.
# Replays the 224 expand + 225 contract up-files over fixtures (each must be idempotent), then proves the
# contract downs are refused and the db-migrate.sh dirty guard blocks `force 0` above the contract floor.
# Config (feature 296): pass 2b/2c run at R-1 before pass 1, R and R+1 are applied by pass 1, pass 3 proves the
# gap-twin rule of R+1, and scripts/migration-assertions/config-<R>.sql asserts the result.
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

FORMULAS_REPO="$REPO_ROOT/services/xstockstrat-indicators/app/services/formulas_repository.py"
# repo_sql <NAME>: the body of a `NAME = """` module constant; max_param <sql>: its highest $n.
repo_sql() { awk -v n="$1" '$0 ~ "^" n " = \"\"\"" {f=1; next} f && /^"""/ {exit} f' "$FORMULAS_REPO"; }
max_param() { printf '%s' "$1" | grep -oE '\$[0-9]+' | tr -d '$' | sort -n | tail -1; }
# check_params <NAME> <expected>: AC-11 must bind exactly the values it supplies.
check_params() {
  local sql n
  sql="$(repo_sql "$1")"
  if [ -z "$sql" ]; then
    echo "migration-rerun: AC-11: $1 not found in $FORMULAS_REPO" >&2
    exit 1
  fi
  n="$(max_param "$sql")"
  if [ "$n" != "$2" ]; then
    echo "migration-rerun: AC-11: $1 has $n params, harness supplies $2" >&2
    exit 1
  fi
}

# Same x-migrations-table rule as db-migrate.sh service_db_url.
service_db_url() {
  case "$DATABASE_URL" in
  *\?*) echo "${DATABASE_URL}&x-migrations-table=$1_schema_migrations" ;;
  *) echo "${DATABASE_URL}?x-migrations-table=$1_schema_migrations" ;;
  esac
}

# R = the one config migration that is the contract of 040_config_markers (feature 296); R+1 is the CHECK migration.
cfg_dir="$REPO_ROOT/services/xstockstrat-config/migrations"
R_FILE=""
r_count=0
for f in "$cfg_dir"/[0-9]*.up.sql; do
  if head -n 5 "$f" | grep -q '^-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql'; then
    R_FILE="$f"
    r_count=$((r_count + 1))
  fi
done
if [ "$r_count" -ne 1 ]; then
  echo "migration-rerun: expected exactly one config migration with contract-of 040_config_markers, found $r_count" >&2
  exit 1
fi
r_base="$(basename "$R_FILE" .up.sql)"
R=$((10#${r_base%%_*}))
cfg_pre=$((R - 1))
R1=$((R + 1))
r1_base=""
for f in "$cfg_dir/$(printf '%03d' "$R1")"_*.up.sql; do
  [ -e "$f" ] && r1_base="$(basename "$f" .up.sql)"
done
if [ -z "$r1_base" ]; then
  echo "migration-rerun: the CHECK migration $(printf '%03d' "$R1")_* after $r_base is missing" >&2
  exit 1
fi
r_actor="system:config-migration-${r_base%%_*}"
r1_actor="system:config-migration-${r1_base%%_*}"
# Tuples in the rendered allow_296 block: 0 while R ships it empty, the signed count afterwards.
allow_tuples="$(sed -n '/allow_296:begin/,/allow_296:end/p' "$R_FILE" | grep -c "^[[:space:]]*('" || true)"

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
  config) migrate -path "$rendered" -database "$url" goto 40 ;;
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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$assertions/fixtures-pre-041.sql"
migrate -path "$analysis_rendered" -database "$(service_db_url analysis)" goto 26
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$assertions/fixtures-post-224.sql"

# ── config contract passes (feature 296): R is the config migration that is the contract of 040 ────────────────
# 041-043 and the AC-28 legs run at cfg_pre = R-1 and the real-file AC-18/AC-19 test of R runs before pass 1,
# because R (and the CHECK after it) would reject 041's replayed prefixed seeds (041 is immutable, F-01).
fail() {
  echo "migration-rerun: $*" >&2
  exit 1
}
# sha256_of <file>: the CI container has sha256sum, a macOS host only shasum.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
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
must_be_clean() {
  if [ "$(mig_version "$1")" != "$2" ]; then
    echo "migration-rerun: $1 should be clean at $2, got: $(mig_version "$1")" >&2
    exit 1
  fi
}
cfg_force() { migrate -path "$cfg_dir" -database "$(service_db_url config)" force "$1"; }
cfg_goto() { migrate -path "$cfg_dir" -database "$(service_db_url config)" goto "$1"; }
# run_assertion <file>: the config-NNN.sql files read these GUCs because psql does not substitute :vars inside $$ bodies.
run_assertion() {
  echo "==> assertion: $(basename "$1")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v seed_user_id="$SEED_USER_ID" -v allow_tuples="$allow_tuples" \
    -v r_actor="$r_actor" -v r1_actor="$r1_actor" -f "$1"
}
# config_pre_assertions: the config-NNN.sql files below R describe the pre-R state.
config_pre_assertions() {
  local sql n
  for sql in "$assertions"/config-[0-9]*.sql; do
    [ -e "$sql" ] || continue
    n="$(basename "$sql" .sql)"
    n=$((10#${n#config-}))
    if [ "$n" -lt "$R" ]; then run_assertion "$sql"; fi
  done
}
latest_run="SELECT COALESCE(max(run_at)::text, '') FROM config.config_heal_report_041;"
counts="SELECT (SELECT count(*) FROM config.config_values) || ':' || (SELECT count(*) FROM config.config_audit)
  || ':' || (SELECT count(*) FROM config.config_heal_report_041);"
fn_defs="SELECT md5(pg_get_functiondef('config.audit_config_change()'::regprocedure)
  || pg_get_functiondef('config.audit_config_insert()'::regprocedure));"
knob_alive() {
  if [ "$(sql_value "SELECT count(*) FROM config.config_values WHERE namespace = 'analysis'
      AND key = 'backtest.extra_knob' AND environment = 'staging' AND user_id IS NULL;")" != "1" ]; then
    echo "migration-rerun: AC-28 $1: analysis/backtest.extra_knob was deleted" >&2
    exit 1
  fi
  # Only re-runs after run_a count: the first run legitimately deletes the G2-signed twins.
  if [ "$(sql_value "SELECT count(*) FROM config.config_heal_report_041 WHERE action = 'twin-deleted'
      AND ('$run_a' = '' OR run_at > '$run_a'::timestamptz);")" != "0" ]; then
    echo "migration-rerun: AC-28 $1: a re-run deleted a row" >&2
    exit 1
  fi
}

echo "==> pass 2b (AC-28): re-running config 041 never deletes a later-created key (config at $cfg_pre, before $r_base)"
# Config sits at 40 after pass 0: 041 (which creates config_heal_report_041) has not run yet.
cfg_goto "$cfg_pre"
must_be_clean config "$cfg_pre"
sql_value "INSERT INTO config.config_values (namespace, key, value_type, value_data, description, consuming_service,
  environment, user_id, updated_by) VALUES ('analysis', 'backtest.extra_knob', 'int', '1', 'AC-28 operator key',
  'xstockstrat-analysis', 'staging', NULL, 'migration-rerun') RETURNING id;" >/dev/null

echo "  → (a) latch present: force 40 + goto is a no-op"
run_a="$(sql_value "$latest_run")"
counts_a="$(sql_value "$counts")"
cfg_force 40
cfg_goto "$cfg_pre"
must_be_clean config "$cfg_pre"
knob_alive "(a)"
if [ "$(sql_value "$latest_run")" != "$run_a" ] || [ "$(sql_value "$counts")" != "$counts_a" ]; then
  echo "migration-rerun: AC-28 (a): latched re-run changed rows/audit/report ($counts_a -> $(sql_value "$counts"))" >&2
  exit 1
fi

echo "  → (b) latch deleted: force 40 + goto re-runs the heal"
sql_value "DELETE FROM config.config_heal_report_041 WHERE action = 'latch' RETURNING 1;" >/dev/null
cfg_force 40
cfg_goto "$cfg_pre"
must_be_clean config "$cfg_pre"
knob_alive "(b)"
if [ "$(sql_value "$latest_run")" = "$run_a" ] ||
  [ "$(sql_value "SELECT count(*) FROM config.config_heal_report_041 WHERE action = 'latch';")" != "1" ]; then
  echo "migration-rerun: AC-28 (b): the unlatched re-run did not run or did not re-latch" >&2
  exit 1
fi

echo "  → (c) dirty at 41: the dirty guard refuses the automatic force 0 (contract floor 40)"
cfg_force 41
sql_value "UPDATE public.config_schema_migrations SET dirty = true RETURNING version;" >/dev/null
counts_c="$(sql_value "$counts")"
fns_c="$(sql_value "$fn_defs")"
rc=0
"$REPO_ROOT/scripts/migration-dirty-guard.sh" "$cfg_dir" config "41 (dirty)" >"$out" 2>&1 || rc=$?
[ "$rc" -eq 3 ] || fail "AC-28 (c): the dirty guard exited $rc at 41, want 3"
must_contain "config is dirty at version 41" "AC-28 (c)"
must_contain "force 40" "AC-28 (c)"
if [ "$(sql_value "$counts")" != "$counts_c" ] || [ "$(sql_value "$fn_defs")" != "$fns_c" ]; then
  echo "migration-rerun: AC-28 (c): the guard call changed rows or audit functions" >&2
  exit 1
fi
cfg_force 40
cfg_goto "$cfg_pre"
must_be_clean config "$cfg_pre"
knob_alive "(c)"
if [ "$(sql_value "$counts")" != "$counts_c" ]; then
  echo "migration-rerun: AC-28 (c): recovery changed rows/audit/report" >&2
  exit 1
fi

echo "==> pass 2c: pre-R config assertions, then the real-file AC-18/AC-19 test of $r_base"
config_pre_assertions

r_sha_before="$(sha256_of "$R_FILE")"
counts_r="$(sql_value "$counts")"
if migrate -path "$cfg_dir" -database "$(service_db_url config)" up 1 >"$out" 2>&1; then
  fail "AC-19: $r_base applied over unsigned and secret-class twins"
fi
grep -Eq 'feature 296: [0-9]+ violation\(s\); nothing changed' "$out" || {
  cat "$out" >&2
  fail "AC-19: $r_base did not raise the feature-296 violation header"
}
must_contain "secret-class-twin marketdata/fmp.api_key/staging" "AC-18"
must_contain "uncovered-twin analysis/fundsignal.valid_days/staging" "AC-19"
# awk exits on its own: a grep|head pipeline gets SIGPIPE (exit 141) under pipefail when grep has a second match.
l_secret="$(awk '/secret-class-twin marketdata\/fmp.api_key\/staging/ { print NR; exit }' "$out")"
l_unc="$(awk '/uncovered-twin analysis\/fundsignal.valid_days\/staging/ { print NR; exit }' "$out")"
[ "$l_secret" -lt "$l_unc" ] || fail "AC-19: violation lines are not in rank order"
# migrate echoes the migration's SQL text too, so only whole lines that start with a violation class are checked:
# each must be exactly "<class> <namespace>/<key>/<environment>" with no value after it.
if grep -qF 'legacy-fmp-value-295' "$out" ||
  awk '/^(secret-class-twin|uncovered-twin|ambiguous-signature|stale-signature|double-prefix|oracle-mismatch|secret-parked-candidate) / {
    if ($0 !~ /^[a-z-]+ [A-Za-z0-9_]+\/[^ ]+\/(staging|production)( \(per-user\))?$/) bad = 1
  } END { exit !bad }' "$out"; then
  fail "AC-18/AC-19: the raise printed a value"
fi
must_be_dirty config "$R"
[ "$(sql_value "$counts")" = "$counts_r" ] || fail "AC-19: the raised $r_base changed rows, audit or report"
[ "$(sql_value "SELECT to_regclass('config.config_keys_report_296') IS NULL;")" = "t" ] ||
  fail "AC-19: the raised $r_base left report tables behind"
[ "$(sql_value "SELECT count(*) FROM config.config_markers WHERE name = 'relative_keys_v1';")" = "0" ] ||
  fail "AC-19: the raised $r_base set the marker"
rc=0
"$REPO_ROOT/scripts/migration-dirty-guard.sh" "$cfg_dir" config "$R (dirty)" >"$out" 2>&1 || rc=$?
[ "$rc" -eq 3 ] || fail "AC-19: the dirty guard exited $rc at $R, want 3"
must_contain "force $cfg_pre" "AC-19 dirty guard"

echo "  → repair by hand (unread duplicates and the plaintext secret-class twin), then converge with $r_base unchanged"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
WITH d AS (
  DELETE FROM config.config_values
   WHERE namespace = 'marketdata' AND key = 'marketdata.fmp.api_key' AND environment = 'staging'
     AND user_id IS NULL AND NOT is_secret
  RETURNING namespace, key, environment, user_id)
INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, user_id)
SELECT namespace, key, NULL, NULL, 'migration-rerun', 'AC-19 repair: plaintext secret-class twin', environment, user_id FROM d;
WITH d AS (
  DELETE FROM config.config_values r
   USING config.config_values p
   WHERE NOT r.is_secret AND NOT p.is_secret
     AND r.namespace = p.namespace AND r.environment = p.environment
     AND COALESCE(r.user_id, '') = COALESCE(p.user_id, '')
     AND left(p.key, length(p.namespace) + 1) = p.namespace || '.'
     AND r.key = substr(p.key, length(p.namespace) + 2)
  RETURNING r.namespace, r.key, r.environment, r.user_id, r.value_data)
INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, user_id)
SELECT namespace, key, value_data, NULL, 'migration-rerun', 'AC-19 repair: unread duplicate', environment, user_id FROM d;
COMMIT;
SQL
cfg_force "$cfg_pre"

# run_signed <tuples file> <setup sql> [asserts sql]: R with its allow block replaced, inside BEGIN … ROLLBACK.
r_copy_dir="$(mktemp -d)"
run_signed() {
  awk -v tuples="$1" '/-- allow_296:begin/ { print; while ((getline line < tuples) > 0) print line; skip = 1; next }
    /-- allow_296:end/ { skip = 0 } !skip { print }' "$R_FILE" >"$r_copy_dir/r_signed.sql"
  if [ -n "${3:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$2" -f "$r_copy_dir/r_signed.sql" -f "$3"
  else
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$2" -f "$r_copy_dir/r_signed.sql"
  fi
}
sha_of() { printf "encode(sha256(convert_to('%s', 'UTF8')), 'hex')" "$1"; }
ins_cols="(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id, updated_by, updated_at)"

echo "  → signed-tuple happy path (AC-9, AC-16, AC-20, AC-21) on a copy of $r_base, rolled back"
tuples="$(mktemp)"
{
  echo "VALUES"
  echo "  ('indicators', 'sandbox.timeout_ms', 'staging', NULL, $(sha_of 5000)),"
  echo "  ('ledger', 'happy.equal', 'staging', NULL, $(sha_of 7)),"
  echo "  ('ledger', 'ledger.happy.lone', 'staging', NULL, $(sha_of 9))"
} >"$tuples"
setup="$(mktemp)"
cat >"$setup" <<SQL
BEGIN;
UPDATE config.config_values SET value_data = '15000'
 WHERE namespace = 'indicators' AND key = 'indicators.sandbox.timeout_ms' AND environment = 'staging' AND user_id IS NULL;
INSERT INTO config.config_values $ins_cols VALUES
  ('indicators', 'sandbox.timeout_ms', 'int', '5000', 'AC-9 relative twin', '5000', 'xstockstrat-indicators', 'staging', NULL, 'migration-rerun', now()),
  ('indicators', 'indicators.sandbox.timeout_ms', 'int', '20000', 'AC-9 per-user', '5000', 'xstockstrat-indicators', 'staging', 'u-100', 'u-100', now()),
  ('ledger', 'ledger.happy.meta', 'int', '11', 'AC-16 metadata', '11', 'xstockstrat-ledger', 'staging', NULL, 'alice', '2026-01-02 03:04:05+00'),
  ('ledger', 'happy.equal', 'int', '7', 'equal-valued twin', '7', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now()),
  ('ledger', 'ledger.happy.equal', 'int', '7', 'equal-valued twin', '7', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now()),
  ('ledger', 'ledger.happy.lone', 'int', '9', 'lone prefixed row', '9', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now());
SQL
asserts="$(mktemp)"
cat >"$asserts" <<SQL
DO \$\$
BEGIN
  IF (SELECT value_data FROM config.config_values WHERE namespace = 'indicators' AND key = 'sandbox.timeout_ms'
        AND environment = 'staging' AND user_id IS NULL) IS DISTINCT FROM '15000' THEN
    RAISE EXCEPTION 'AC-9: the global row does not hold the signed winner 15000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values_premigration_296 WHERE namespace = 'indicators'
        AND key = 'sandbox.timeout_ms' AND environment = 'staging' AND user_id IS NULL AND value_data = '5000') THEN
    RAISE EXCEPTION 'AC-9: the 5000 twin is not preserved in the snapshot table';
  END IF;
  IF (SELECT value_data FROM config.config_values WHERE namespace = 'indicators' AND key = 'sandbox.timeout_ms'
        AND environment = 'staging' AND user_id = 'u-100') IS DISTINCT FROM '20000' THEN
    RAISE EXCEPTION 'AC-9/AC-20: the per-user prefixed read-spelling row was not renamed to 20000';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_keys_report_296 WHERE user_id = 'u-100') THEN
    RAISE EXCEPTION 'AC-20: a per-user prefixed read-spelling row was parked, not renamed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'ledger' AND key = 'happy.meta'
        AND updated_by = 'alice' AND updated_at = '2026-01-02 03:04:05+00') THEN
    RAISE EXCEPTION 'AC-16: the renamed row lost updated_by or updated_at';
  END IF;
  IF (SELECT count(*) FROM config.config_audit WHERE namespace = 'ledger' AND key = 'happy.meta'
        AND changed_by = '$r_actor' AND reason LIKE 'feature 296: renamed from %') <> 1 THEN
    RAISE EXCEPTION 'AC-16: expected exactly one rename audit row for the renamed row';
  END IF;
  IF (SELECT count(*) FROM config.config_values WHERE namespace = 'ledger' AND key IN ('happy.equal', 'ledger.happy.equal')) <> 1 THEN
    RAISE EXCEPTION 'AC-9: the equal-valued twin pair did not collapse to one row';
  END IF;
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'unmatched-signed-tuple') <> 1
     OR NOT EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'ledger' AND key = 'happy.lone') THEN
    RAISE EXCEPTION 'AC-21: the lone-row tuple must be reported once and its row renamed, not deleted';
  END IF;
END \$\$;
ROLLBACK;
SQL
run_signed "$tuples" "$setup" "$asserts"

echo "  → stale-signature and ambiguous-signature (AC-19), each rolled back"
for mode in stale ambiguous; do
  tuples="$(mktemp)"
  setup="$(mktemp)"
  if [ "$mode" = "stale" ]; then
    twin_key=stale
    printf "VALUES\n  ('ledger', 'happy.stale', 'staging', NULL, %s)\n" "$(sha_of 3)" >"$tuples"
  else
    twin_key=amb
    printf "VALUES\n  ('ledger', 'happy.amb', 'staging', NULL, %s),\n  ('ledger', 'ledger.happy.amb', 'staging', NULL, %s)\n" "$(sha_of 1)" "$(sha_of 2)" >"$tuples"
  fi
  cat >"$setup" <<SQL
BEGIN;
INSERT INTO config.config_values $ins_cols VALUES
  ('ledger', 'happy.$twin_key', 'int', '1', 'twin', '1', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now()),
  ('ledger', 'ledger.happy.$twin_key', 'int', '2', 'twin', '1', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now());
SQL
  if run_signed "$tuples" "$setup" >"$out" 2>&1; then
    fail "AC-19: a $mode-signature twin was accepted"
  fi
  if [ "$mode" = "stale" ]; then
    must_contain "stale-signature ledger/happy.stale/staging" "AC-19"
  else
    must_contain "ambiguous-signature ledger/happy.amb/staging" "AC-19"
  fi
done

echo "==> pass 1: db-migrate.sh up (applies $r_base and $r1_base)"
# AC-8: a LISTEN session records the per-(namespace, environment) and marker notifications of the apply; psql
# prints them when the sleep query returns, so the sleep outlasts pass 1 and is waited on after pass 3.
listen_out="$(mktemp)"
psql "$DATABASE_URL" -At -c 'LISTEN config_changed' -c 'SELECT pg_sleep(240)' >"$listen_out" 2>&1 &
listen_pid=$!
"$REPO_ROOT/scripts/db-migrate.sh" up
triggers_1="$(count_n1_triggers)"
[ "$(sha256_of "$R_FILE")" = "$r_sha_before" ] ||
  fail "AC-19: $r_base changed between the failing run and the converged run"

# Pre-224 up-files are not idempotent (docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md)
# and applied migrations are immutable (F-01), so only the 224 expand and 225 contract up-files are replayed.
echo "==> pass 2: re-apply the feature-224/225 up-files on the migrated schema"
replay="$(mktemp -d)"
for pair in indicators:007_private_formulas_templates ingest:013_signal_ownership_templates \
  ingest:014_contract_signal_ownership analysis:026_owner_dimension_templates \
  analysis:027_contract_owner_dimension "config:$r_base" "config:$r1_base"; do
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

refuse_down config "$cfg_pre" "${r_base%%_*}"
if [ "$(sql_value "SELECT count(*) FROM pg_constraint WHERE conname = 'config_values_key_relative_check';")" != "0" ]; then
  fail "R+1: the refused down left the key CHECK in place"
fi
echo "  → gap rows a previous-image server writes between R and R+1 (staging, global)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment,
   user_id, updated_by, caller_identity, updated_at)
VALUES
  -- F1 operator P newer than Rel -> P wins
  ('analysis', 'analysis.backtest.extra_knob', 'int', '2', FALSE, 'F1', '1', 'xstockstrat-analysis', 'staging', NULL, 'migration-rerun-operator', NULL, now()),
  -- F2 poller P newer than Rel -> P wins, caller_identity kept
  ('platform', 'platform.trading_state', 'string', 'REDUCE_ONLY', FALSE, 'F2', 'ACTIVE', 'xstockstrat-trading', 'staging', NULL, 'trading-reconciliation-poller', 'trading-reconciliation-poller', now()),
  -- F3 NULL-author P loses even though newer
  ('analysis', 'backtest.null_knob', 'int', '3', FALSE, 'F3 rel', '3', 'xstockstrat-analysis', 'staging', NULL, 'migration-rerun', NULL, now() - interval '1 hour'),
  ('analysis', 'analysis.backtest.null_knob', 'int', '9', FALSE, 'F3 P', '3', 'xstockstrat-analysis', 'staging', NULL, NULL, NULL, now()),
  -- F4 migration-authored P loses
  ('analysis', 'backtest.seed_knob', 'int', '3', FALSE, 'F4 rel', '3', 'xstockstrat-analysis', 'staging', NULL, 'migration-rerun', NULL, now() - interval '1 hour'),
  ('analysis', 'analysis.backtest.seed_knob', 'int', '9', FALSE, 'F4 P', '3', 'xstockstrat-analysis', 'staging', NULL, 'system:config-migration-043', NULL, now()),
  -- F5 operator P older than Rel -> Rel wins
  ('analysis', 'analysis.backtest.keep_knob', 'int', '6', FALSE, 'F5 P', '7', 'xstockstrat-analysis', 'staging', NULL, 'migration-rerun-operator', NULL, now() - interval '2 hours'),
  ('analysis', 'backtest.keep_knob', 'int', '7', FALSE, 'F5 rel', '7', 'xstockstrat-analysis', 'staging', NULL, 'migration-rerun', NULL, now() - interval '1 hour'),
  -- F6 both-secret gap twin: resolved by the same rule, audit values NULL
  ('ledger', 'happy6.sealed', 'string', '[redacted]', TRUE, 'F6 rel', '', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', NULL, now() - interval '1 hour'),
  ('ledger', 'ledger.happy6.sealed', 'string', '[redacted]', TRUE, 'F6 P', '', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun-operator', NULL, now()),
  -- F7 mixed-class gap twin: R+1 raises (separate sub-test below)
  ('ledger', 'happy7.mixed', 'string', 'plain', FALSE, 'F7 rel', '', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', NULL, now() - interval '1 hour'),
  ('ledger', 'ledger.happy7.mixed', 'string', '[redacted]', TRUE, 'F7 P', '', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun-operator', NULL, now());
SQL
guard_blocks config "$cfg_pre" "$((cfg_pre - 1))"
echo "  → R+1: a mixed-class gap twin raises and changes nothing"
cfg_force "$R"
counts_f="$(sql_value "$counts")"
if migrate -path "$cfg_dir" -database "$(service_db_url config)" up >"$out" 2>&1; then
  fail "R+1: a mixed-class gap twin was accepted"
fi
must_contain "mixed-class-gap-twin ledger/happy7.mixed/staging" "R+1"
must_contain "violation(s); nothing changed" "R+1"
must_be_dirty config "$R1"
[ "$(sql_value "$counts")" = "$counts_f" ] || fail "R+1: the raised CHECK migration changed rows or audit"
sql_value "WITH d AS (DELETE FROM config.config_values WHERE namespace = 'ledger' AND key = 'happy7.mixed'
    AND environment = 'staging' AND user_id IS NULL RETURNING namespace, key, environment)
  INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment)
  SELECT namespace, key, NULL, NULL, 'migration-rerun', 'F7 repair: delete the plaintext member', environment FROM d
  RETURNING 1;" >/dev/null
cfg_force "$R"

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
for want in ingest:14 analysis:27 "config:$R1"; do
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
  config-[0-9]*)
    # config-NNN.sql below R describe the pre-R state and ran at cfg_pre (pass 2c); by rule, not by name.
    n="$(basename "$sql" .sql)"
    n=$((10#${n#config-}))
    if [ "$n" -lt "$R" ]; then continue; fi
    ;;
  esac
  run_assertion "$sql"
done

echo "==> AC-8: the apply notified every touched (namespace, environment) and the marker"
wait "$listen_pid" || true
grep -qF '{"marker":"relative_keys_v1"}' "$listen_out" || {
  cat "$listen_out" >&2
  fail "AC-8: no marker notification was received"
}
grep -q '"namespace"' "$listen_out" || fail "AC-8: no per-(namespace, environment) notification was received"

echo "==> pass 4: an older migrator skips a newer clean schema and refuses a newer dirty one"
old="$(mktemp -d)"
mkdir -p "$old/scripts"
for s in db-migrate.sh render-migrations.sh migration-dirty-guard.sh migration-ahead-check.sh; do cp "$REPO_ROOT/scripts/$s" "$old/scripts/"; done
for schema in $SCHEMAS; do
  [ -d "$REPO_ROOT/services/xstockstrat-$schema/migrations" ] || continue
  mkdir -p "$old/services/xstockstrat-$schema"
  cp -R "$REPO_ROOT/services/xstockstrat-$schema/migrations" "$old/services/xstockstrat-$schema/"
done
md="$old/services/xstockstrat-marketdata/migrations"
top=0
top_file=""
for f in "$md"/*.up.sql; do
  v="$(basename "$f" | sed 's/^\([0-9]*\)_.*/\1/; s/^0*//')"
  v="${v:-0}"
  if [ "$v" -gt "$top" ]; then
    top="$v"
    top_file="$(basename "$f" .up.sql)"
  fi
done
[ -n "$top_file" ] || {
  echo "migration-rerun: pass 4 needs a marketdata migration above 000" >&2
  exit 1
}
rm "$md/$top_file".*.sql
bash "$old/scripts/db-migrate.sh" up >"$out" 2>&1 || {
  cat "$out" >&2
  echo "migration-rerun: pass 4 clean-ahead failed" >&2
  exit 1
}
must_contain "[ahead] marketdata is at version $top" "pass 4 clean-ahead"
[ "$(mig_version marketdata)" = "$top" ] || {
  echo "migration-rerun: marketdata moved off $top" >&2
  exit 1
}
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE public.marketdata_schema_migrations SET dirty = true;"
rc=0
bash "$old/scripts/migration-ahead-check.sh" "$md" marketdata "$(mig_version marketdata)" 2>/dev/null || rc=$?
[ "$rc" -eq 4 ] || {
  echo "migration-rerun: ahead check returned $rc, want 4" >&2
  exit 1
}
rc=0
bash "$old/scripts/db-migrate.sh" up >"$out" 2>&1 || rc=$?
[ "$rc" -eq 1 ] || {
  echo "migration-rerun: old db-migrate.sh returned $rc on dirty-ahead, want 1" >&2
  exit 1
}
must_contain "marketdata is dirty at version $top" "pass 4 dirty-ahead"
must_contain "force $((top - 1))" "pass 4 dirty-ahead"
if grep -qE 'postgres(ql)?://' "$out"; then
  echo "migration-rerun: pass 4 printed a URL" >&2
  exit 1
fi
must_be_dirty marketdata "$top"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE public.marketdata_schema_migrations SET dirty = false;"
"$REPO_ROOT/scripts/db-migrate.sh" up
rm -rf "$old"

check_params _INSERT_SQL 13
check_params _UPDATE_SQL 8
check_params _UPSERT_SQL 10
ac11="$(mktemp)"
{
  echo "BEGIN;"
  echo "ALTER TABLE indicators.formulas DROP COLUMN is_public;"
  printf 'PREPARE ins AS %s;\n' "$(repo_sql _INSERT_SQL)"
  cat <<'SQL'
EXECUTE ins('00000000-0000-4000-8225-000000000011', 'ac11', '', 'result = close', 'u-ac11', '{}', '[]', '[]', 0, '[]', NULL, NULL, NULL); -- RegisterFormula
EXECUTE ins('00000000-0000-4000-8225-000000000012', 'ac11-tpl', '', 'result = close', 'u-ac11', '{}', '[]', '[]', 0, '[]', 'tpl-ac11', 1, '00000000-0000-4000-8225-0000000000a1'); -- template instantiate
SQL
  printf 'PREPARE upd AS %s;\n' "$(repo_sql _UPDATE_SQL)"
  cat <<'SQL'
EXECUTE upd('00000000-0000-4000-8225-000000000011', 'ac11b', '', 'result = open', '[]', '[]', 0, '[]'); -- UpdateFormula
SQL
  printf 'PREPARE ups AS %s;\n' "$(repo_sql _UPSERT_SQL)"
  cat <<'SQL'
EXECUTE ups('00000000-0000-4000-8225-000000000013', 'ac11-seed', '', 'result = close', 'system', '{}', '[]', '[]', 0, '[]'); -- seed upsert
EXECUTE ups('00000000-0000-4000-8225-000000000013', 'ac11-seed2', '', 'result = close', 'system', '{}', '[]', '[]', 0, '[]'); -- seed upsert (conflict path)
ROLLBACK;
SQL
} >"$ac11"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ac11"
echo "==> AC-11: indicators write SQL runs without is_public"

echo "==> migration-rerun: OK (replay idempotent, contract downs refused, dirty guard enforced, older migrator tolerates a newer schema)"
