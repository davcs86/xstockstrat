#!/usr/bin/env python3
"""CI-only (job: migration-rerun): replay the contract migrations over fixtures and assert the result.

Usage: migration-rerun.py   (in the migrator image, on a fresh database)
Needs DATABASE_URL and SEED_USER_ID, plus psql and migrate on PATH.
Replays the 224 expand + 225 contract up-files over fixtures (each must be idempotent), then proves the
contract downs are refused and the db-migrate.sh dirty guard blocks `force 0` above the contract floor.
Config (feature 296): pass 2b/2c run at R-1 before pass 1, R and R+1 are applied by pass 1, pass 3 proves the
gap-twin rule of R+1, and scripts/migration-assertions/config-<R>.sql asserts the result.
Exit 1 = a failed check (stderr line prefixed `migration-rerun:`); otherwise the failing command's status.
"""

import fnmatch
import glob
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
SCHEMAS = [
    "config",
    "ledger",
    "identity",
    "marketdata",
    "trading",
    "portfolio",
    "notify",
    "ingest",
    "indicators",
    "analysis",
]
PRE_224 = {"config": "40", "indicators": "6", "ingest": "12", "analysis": "25"}
ASSERTIONS = os.path.join(SCRIPTS_DIR, "migration-assertions")
CFG_DIR = os.path.join(REPO_ROOT, "services/xstockstrat-config/migrations")
FORMULAS_REPO = os.path.join(
    REPO_ROOT, "services/xstockstrat-indicators/app/services/formulas_repository.py"
)
RENDER = os.path.join(SCRIPTS_DIR, "render-migrations.sh")
DB_MIGRATE = os.path.join(SCRIPTS_DIR, "db-migrate.sh")
DIRTY_GUARD = os.path.join(SCRIPTS_DIR, "migration-dirty-guard.sh")
OLD_MIGRATOR = (
    "db-migrate.sh",
    "render-migrations.sh",
    "migration-dirty-guard.sh",
    "migration-ahead-check.sh",
)
REPLAYS = (
    ("indicators", "007_private_formulas_templates"),
    ("ingest", "013_signal_ownership_templates"),
    ("ingest", "014_contract_signal_ownership"),
    ("analysis", "026_owner_dimension_templates"),
    ("analysis", "027_contract_owner_dimension"),
)

CONTRACT_OF = re.compile(
    r"^-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql"
)
TUPLE = re.compile(r"[ \t\n\v\f\r]*\('")
SEED_REF = re.compile(rb"\$\{SEED_USER_ID\}|\$SEED_USER_ID(?![A-Za-z0-9_])")
PARAM = re.compile(r"\$([0-9]+)")
VIOLATION_HEADER = re.compile(r"feature 296: [0-9]+ violation\(s\); nothing changed")
URL = re.compile(r"postgres(ql)?://")

D_ACTOR = "system:config-migration-feature-305"
A_ACTOR = "system:config-migration-feature-306"
INS_COLS = "(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id, updated_by, updated_at)"
SHA_OF = "encode(sha256(convert_to('{value}', 'UTF8')), 'hex')"

N1_TRIGGERS_SQL = (
    "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%_n1_owner_fill%';"
)
FRESH_SQL = "SELECT to_regclass('public.indicators_schema_migrations') IS NULL;"
LATEST_RUN_SQL = (
    "SELECT COALESCE(max(run_at)::text, '') FROM config.config_heal_report_041;"
)
COUNTS_SQL = """SELECT (SELECT count(*) FROM config.config_values) || ':' || (SELECT count(*) FROM config.config_audit)
  || ':' || (SELECT count(*) FROM config.config_heal_report_041);"""
FN_DEFS_SQL = """SELECT md5(pg_get_functiondef('config.audit_config_change()'::regprocedure)
  || pg_get_functiondef('config.audit_config_insert()'::regprocedure));"""
KNOB_ALIVE_SQL = """SELECT count(*) FROM config.config_values WHERE namespace = 'analysis'
      AND key = 'backtest.extra_knob' AND environment = 'staging' AND user_id IS NULL;"""
RERUN_DELETED_SQL = """SELECT count(*) FROM config.config_heal_report_041 WHERE action = 'twin-deleted'
      AND ('{run_a}' = '' OR run_at > '{run_a}'::timestamptz);"""
KNOB_INSERT_SQL = """INSERT INTO config.config_values (namespace, key, value_type, value_data, description, consuming_service,
  environment, user_id, updated_by) VALUES ('analysis', 'backtest.extra_knob', 'int', '1', 'AC-28 operator key',
  'xstockstrat-analysis', 'staging', NULL, 'migration-rerun') RETURNING id;"""
LATCH_DELETE_SQL = (
    "DELETE FROM config.config_heal_report_041 WHERE action = 'latch' RETURNING 1;"
)
LATCH_COUNT_SQL = (
    "SELECT count(*) FROM config.config_heal_report_041 WHERE action = 'latch';"
)
CONFIG_DIRTY_SQL = (
    "UPDATE public.config_schema_migrations SET dirty = true RETURNING version;"
)
REPORT_ABSENT_SQL = "SELECT to_regclass('config.config_keys_report_296') IS NULL;"
MARKER_COUNT_SQL = (
    "SELECT count(*) FROM config.config_markers WHERE name = 'relative_keys_v1';"
)
FINGERPRINT_SQL = """SELECT (SELECT count(*) FROM config.config_values) || ':' || (SELECT count(*) FROM config.config_audit)
    || ':' || (SELECT count(*) FROM config.config_keys_report_296)
    || ':' || (SELECT count(*) FROM config.config_values_premigration_296)
    || ':' || (SELECT count(*) FROM config.config_markers);"""

D_JOIN = "JOIN {block} ON dead_rows_305.namespace = {alias}.namespace AND dead_rows_305.key = {alias}.key AND dead_rows_305.environment = {alias}.environment"
D_LIVE_SQL = (
    "SELECT count(*) FROM config.config_values v {join} WHERE v.user_id IS NULL;"
)
D_LIVE_SIGNED_SQL = """SELECT count(*) FROM config.config_values v {join} WHERE v.user_id IS NULL
  AND encode(sha256(convert_to(v.value_data, 'UTF8')), 'hex') = dead_rows_305.value_sha256;"""
D_REST_SQL = """SELECT COALESCE(md5(string_agg(v.id::text || '|' || v.namespace || '|' || v.key || '|' || v.environment || '|'
    || COALESCE(v.user_id, '') || '|' || COALESCE(v.value_data, ''), ',' ORDER BY v.id)), '')
  FROM config.config_values v
  WHERE NOT EXISTS (SELECT 1 FROM {block} WHERE dead_rows_305.namespace = v.namespace AND dead_rows_305.key = v.key
    AND dead_rows_305.environment = v.environment AND v.user_id IS NULL);"""
D_MARKER_SQL = "SELECT set_at FROM config.config_markers WHERE name = 'dead_rows_305';"
D_RESTORE_AUDIT_SQL = """SELECT count(*) FROM config.config_audit WHERE changed_by = '{actor}'
  AND reason = 'feature 305: down restores a dead row';"""
D_DELETED_SQL = """SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'dead-row-deleted'
  AND run_at = '{set_after}'::timestamptz;"""

A_JOIN = "JOIN {block} ON alias_removal_306.namespace = {alias}.namespace AND alias_removal_306.key = {alias}.key"
A_LIVE_SQL = (
    "SELECT count(*) FROM config.config_values v {join} WHERE v.user_id IS NULL;"
)
A_REST_SQL = """SELECT COALESCE(md5(string_agg(v.id::text || '|' || v.namespace || '|' || v.key || '|' || v.environment || '|'
    || COALESCE(v.user_id, '') || '|' || COALESCE(v.value_data, ''), ',' ORDER BY v.id)), '')
  FROM config.config_values v
  WHERE NOT EXISTS (SELECT 1 FROM {block} WHERE alias_removal_306.namespace = v.namespace AND alias_removal_306.key = v.key);"""
A_MARKER_SQL = (
    "SELECT set_at FROM config.config_markers WHERE name = 'alias_removal_rows_306';"
)
A_DELETED_SQL = """SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'alias-removal-row-deleted'
  AND run_at = '{set_at}'::timestamptz;"""
A_RESTORE_AUDIT_SQL = """SELECT count(*) FROM config.config_audit WHERE changed_by = '{actor}'
  AND reason = 'feature 306: down restores an alias-removal row';"""

MARKER_LATER_SQL = "SELECT '{set_after}'::timestamptz > '{set_before}'::timestamptz;"
SNAPSHOT_SQL = """SELECT count(*) FROM config.config_values_premigration_296 s {join}
  WHERE s.user_id IS NULL AND s.snapshot_at >= '{set_after}'::timestamptz;"""
DELETE_AUDIT_SQL = """SELECT count(*) FROM config.config_audit WHERE changed_by = '{actor}' AND new_value IS NULL
  AND changed_at >= '{set_after}'::timestamptz;"""

KEY_CHECK_SQL = "SELECT count(*) FROM pg_constraint WHERE conname = 'config_values_key_relative_check';"
F7_REPAIR_SQL = """WITH d AS (DELETE FROM config.config_values WHERE namespace = 'ledger' AND key = 'happy7.mixed'
    AND environment = 'staging' AND user_id IS NULL RETURNING namespace, key, environment)
  INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment)
  SELECT namespace, key, NULL, NULL, 'migration-rerun', 'F7 repair: delete the plaintext member', environment FROM d
  RETURNING 1;"""
DEDUP_ABSENT_SQL = "SELECT to_regclass('ingest.signal_dedup_keys') IS NULL;"
USER_ID_NULLABLE_SQL = """SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'analysis'
    AND table_name = 'backtest_runs' AND column_name = 'user_id';"""
MARKETDATA_DIRTY_SQL = "UPDATE public.marketdata_schema_migrations SET dirty = {dirty};"
AC11_HEAD_SQL = "BEGIN;\nALTER TABLE indicators.formulas DROP COLUMN is_public;\n"

REPAIR_SQL = r"""BEGIN;
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
"""

HAPPY_SETUP_SQL = """BEGIN;
UPDATE config.config_values SET value_data = '15000'
 WHERE namespace = 'indicators' AND key = 'indicators.sandbox.timeout_ms' AND environment = 'staging' AND user_id IS NULL;
INSERT INTO config.config_values {ins_cols} VALUES
  ('indicators', 'sandbox.timeout_ms', 'int', '5000', 'AC-9 relative twin', '5000', 'xstockstrat-indicators', 'staging', NULL, 'migration-rerun', now()),
  ('indicators', 'indicators.sandbox.timeout_ms', 'int', '20000', 'AC-9 per-user', '5000', 'xstockstrat-indicators', 'staging', 'u-100', 'u-100', now()),
  ('ledger', 'ledger.happy.meta', 'int', '11', 'AC-16 metadata', '11', 'xstockstrat-ledger', 'staging', NULL, 'alice', '2026-01-02 03:04:05+00'),
  ('ledger', 'happy.equal', 'int', '7', 'equal-valued twin', '7', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now()),
  ('ledger', 'ledger.happy.equal', 'int', '7', 'equal-valued twin', '7', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now()),
  ('ledger', 'ledger.happy.lone', 'int', '9', 'lone prefixed row', '9', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now());
"""

HAPPY_ASSERTS_SQL = """DO $$
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
        AND changed_by = '{r_actor}' AND reason LIKE 'feature 296: renamed from %') <> 1 THEN
    RAISE EXCEPTION 'AC-16: expected exactly one rename audit row for the renamed row';
  END IF;
  IF (SELECT count(*) FROM config.config_values WHERE namespace = 'ledger' AND key IN ('happy.equal', 'ledger.happy.equal')) <> 1 THEN
    RAISE EXCEPTION 'AC-9: the equal-valued twin pair did not collapse to one row';
  END IF;
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'unmatched-signed-tuple') <> 1
     OR NOT EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'ledger' AND key = 'happy.lone') THEN
    RAISE EXCEPTION 'AC-21: the lone-row tuple must be reported once and its row renamed, not deleted';
  END IF;
END $$;
ROLLBACK;
"""

TWIN_SETUP_SQL = """BEGIN;
INSERT INTO config.config_values {ins_cols} VALUES
  ('ledger', 'happy.{twin_key}', 'int', '1', 'twin', '1', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now()),
  ('ledger', 'ledger.happy.{twin_key}', 'int', '2', 'twin', '1', 'xstockstrat-ledger', 'staging', NULL, 'migration-rerun', now());
"""

DEAD_ROW_UNHASHED_SQL = r"""BEGIN;
UPDATE config.config_values SET value_data = 'true'
 WHERE namespace = 'marketdata' AND key = 'alpaca.paper' AND environment = 'production' AND user_id IS NULL;
\i :upfile
DO $$
BEGIN
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'dead-row-deleted' AND run_at = now()) <> 3 THEN
    RAISE EXCEPTION 'AC-2: expected 3 dead-row-deleted rows when one signed row no longer hashes';
  END IF;
  IF (SELECT count(*) FROM config.config_values WHERE namespace = 'marketdata' AND key = 'alpaca.paper'
        AND environment = 'production' AND user_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'AC-2: the row that no longer hashes was deleted';
  END IF;
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'unmatched-signed-tuple'
        AND run_at = now() AND reason LIKE 'feature 305:%') <> 1
     OR NOT EXISTS (SELECT 1 FROM config.config_keys_report_296 WHERE action = 'unmatched-signed-tuple'
        AND run_at = now() AND namespace = 'marketdata' AND key = 'alpaca.paper' AND environment = 'production'
        AND user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-2: expected exactly one unmatched-signed-tuple row for marketdata/alpaca.paper/production';
  END IF;
END $$;
ROLLBACK;
"""

ALIAS_PER_USER_SQL = r"""BEGIN;
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
   environment, user_id, updated_by, update_reason)
SELECT namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
       environment, 'pass-2e-user', 'pass 2e', 'pass 2e'
FROM config.config_values
WHERE namespace = 'platform' AND key = 'log_level' AND user_id IS NULL
ORDER BY environment LIMIT 1;
DELETE FROM config.config_markers WHERE name = 'alias_removal_rows_306';
\i :upfile
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'platform' AND key = 'log_level' AND user_id IS NULL) THEN
    RAISE EXCEPTION 'pass 2e (b): a global platform/log_level row survived the up';
  END IF;
  IF (SELECT count(*) FROM config.config_values WHERE namespace = 'platform' AND key = 'log_level'
        AND user_id = 'pass-2e-user') <> 1 THEN
    RAISE EXCEPTION 'pass 2e (b): the per-user row was deleted';
  END IF;
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'alias-removal-out-of-scope'
        AND run_at = now() AND namespace = 'platform' AND key = 'log_level' AND user_id = 'pass-2e-user') <> 1 THEN
    RAISE EXCEPTION 'pass 2e (b): expected exactly one alias-removal-out-of-scope row for the per-user row';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_keys_report_296 WHERE action = 'unmatched-signed-tuple' AND run_at = now()) THEN
    RAISE EXCEPTION 'pass 2e (b): the up wrote an unmatched-signed-tuple row';
  END IF;
END $$;
ROLLBACK;
"""

GAP_ROWS_SQL = r"""INSERT INTO config.config_values
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
"""

AC11_INSERTS_SQL = r"""EXECUTE ins('00000000-0000-4000-8225-000000000011', 'ac11', '', 'result = close', 'u-ac11', '{}', '[]', '[]', 0, '[]', NULL, NULL, NULL); -- RegisterFormula
EXECUTE ins('00000000-0000-4000-8225-000000000012', 'ac11-tpl', '', 'result = close', 'u-ac11', '{}', '[]', '[]', 0, '[]', 'tpl-ac11', 1, '00000000-0000-4000-8225-0000000000a1'); -- template instantiate
"""

AC11_UPDATE_SQL = r"""EXECUTE upd('00000000-0000-4000-8225-000000000011', 'ac11b', '', 'result = open', '[]', '[]', 0, '[]'); -- UpdateFormula
"""

AC11_UPSERTS_SQL = r"""EXECUTE ups('00000000-0000-4000-8225-000000000013', 'ac11-seed', '', 'result = close', 'system', '{}', '[]', '[]', 0, '[]'); -- seed upsert
EXECUTE ups('00000000-0000-4000-8225-000000000013', 'ac11-seed2', '', 'result = close', 'system', '{}', '[]', '[]', 0, '[]'); -- seed upsert (conflict path)
ROLLBACK;
"""


def say(line):
    print(line, flush=True)


def fail(message):
    print(f"migration-rerun: {message}", file=sys.stderr)
    sys.exit(1)


def read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def temp_file(text):
    fd, path = tempfile.mkstemp()
    os.close(fd)
    write(path, text)
    return path


def lines_of(text):
    lines = text.split("\n")
    return lines[:-1] if lines[-1] == "" else lines


def exit_status(done):
    return done.returncode if done.returncode >= 0 else 128 - done.returncode


def call(cmd, text=None):
    """Run cmd on the console; as under `set -e`, a failure ends the run with cmd's status."""
    done = subprocess.run(
        cmd, input=None if text is None else text.encode(), check=False
    )
    if done.returncode:
        sys.exit(exit_status(done))


def captured(cmd):
    """(status, stdout + stderr) of cmd; a failure is the caller's to judge."""
    done = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False
    )
    return exit_status(done), done.stdout.decode("utf-8", errors="replace")


def service_db_url(database_url, schema):
    """Same x-migrations-table rule as db-migrate.sh service_db_url."""
    sep = "&" if "?" in database_url else "?"
    return f"{database_url}{sep}x-migrations-table={schema}_schema_migrations"


def db_url(schema):
    return service_db_url(os.environ["DATABASE_URL"], schema)


def migrations_dir(schema, root=REPO_ROOT):
    return os.path.join(root, f"services/xstockstrat-{schema}/migrations")


def psql_cmd(*args):
    return ["psql", os.environ["DATABASE_URL"], "-v", "ON_ERROR_STOP=1", *args]


def psql(*args, text=None):
    call(psql_cmd(*args), text)


def migrate_cmd(path, schema, *args):
    return ["migrate", "-path", path, "-database", db_url(schema), *args]


def migrate(path, schema, *args):
    call(migrate_cmd(path, schema, *args))


def sql_test(sql, strict=False):
    """One value, read inside a comparison: a psql failure reads as its (empty) stdout and the comparison decides."""
    done = subprocess.run(
        psql_cmd("-tA", "-c", sql), stdout=subprocess.PIPE, check=False
    )
    if strict and done.returncode:
        sys.exit(exit_status(done))
    return done.stdout.decode("utf-8", errors="replace").rstrip("\n")


def sql_value(sql):
    """One value the run depends on: a psql failure ends the run with psql's status."""
    return sql_test(sql, strict=True)


def mig_version(schema):
    return captured(migrate_cmd(migrations_dir(schema), schema, "version"))[1].rstrip(
        "\n"
    )


def must_contain(out, needle, label):
    if needle not in out:
        print(f"migration-rerun: {label}: output lacks '{needle}':", file=sys.stderr)
        sys.stderr.write(out)
        sys.exit(1)


def must_be_dirty(schema, version):
    if not mig_version(schema).startswith(f"{version} (dirty)"):
        fail(f"{schema} should be dirty at {version}, got: {mig_version(schema)}")


def must_be_clean(schema, version):
    if mig_version(schema) != str(version):
        fail(f"{schema} should be clean at {version}, got: {mig_version(schema)}")


def cfg_force(version):
    migrate(CFG_DIR, "config", "force", str(version))


def cfg_goto(version):
    migrate(CFG_DIR, "config", "goto", str(version))


def sha256_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def sha_of(value):
    return SHA_OF.format(value=value)


def render_seed(sql, seed):
    """envsubst '$SEED_USER_ID': only that variable, in its $NAME and ${NAME} forms."""
    return SEED_REF.sub(lambda _: seed, sql)


def marked_lines(text, begin, end):
    """Each line holding `begin` through the next one holding `end`, both included."""
    out, inside = [], False
    for line in lines_of(text):
        if inside:
            out.append(line)
            inside = end not in line
        elif begin in line:
            out.append(line)
            inside = True
    return out


def count_tuples(lines):
    return sum(1 for line in lines if TUPLE.match(line))


def block_body(text, marker):
    return "\n".join(
        marked_lines(text, f"{marker}:begin", f"{marker}:end")[1:-1]
    ).rstrip("\n")


def version_of(path):
    return int(os.path.basename(path).split("_")[0])


def sole(matches, what):
    if len(matches) != 1:
        fail(f"expected exactly one {what}, found {len(matches)}")
    return matches[0]


def discover(cfg_dir):
    """The config migrations this run is about, found by marker or slug, never by number."""
    ups = sorted(glob.glob(os.path.join(cfg_dir, "[0-9]*.up.sql")))
    # R = the one config migration that is the contract of 040_config_markers (feature 296); R+1 is the CHECK migration.
    r_file = sole(
        [f for f in ups if any(map(CONTRACT_OF.search, lines_of(read(f))[:5]))],
        "config migration with contract-of 040_config_markers",
    )
    r_base = os.path.basename(r_file)[: -len(".up.sql")]
    r = version_of(r_file)
    r1_files = sorted(glob.glob(os.path.join(cfg_dir, f"{r + 1:03d}_*.up.sql")))
    if not r1_files:
        fail(f"the CHECK migration {r + 1:03d}_* after {r_base} is missing")
    r1_base = os.path.basename(r1_files[-1])[: -len(".up.sql")]
    # Feature 305: the dead-row migration is found by slug, never by number, so a merge-time renumber needs no edit here.
    d_file = sole(
        sorted(
            glob.glob(os.path.join(cfg_dir, "[0-9]*_config_dead_rows_prune.up.sql"))
        ),
        "*_config_dead_rows_prune.up.sql",
    )
    d_block = block_body(read(d_file), "dead_rows_305")
    # Feature 306: the alias-removal row migration is found by slug as well (the number is the next free one at merge).
    a_file = sole(
        sorted(
            glob.glob(os.path.join(cfg_dir, "[0-9]*_config_alias_removal_rows.up.sql"))
        ),
        "*_config_alias_removal_rows.up.sql",
    )
    a_block = block_body(read(a_file), "alias_removal_306")
    return SimpleNamespace(
        r_file=r_file,
        r_base=r_base,
        r=r,
        cfg_pre=r - 1,
        r1=r + 1,
        r1_base=r1_base,
        r_actor=f"system:config-migration-{r_base.split('_')[0]}",
        r1_actor=f"system:config-migration-{r1_base.split('_')[0]}",
        # Tuples in the rendered allow_296 block: 0 while R ships it empty, the signed count afterwards.
        allow_tuples=count_tuples(
            marked_lines(read(r_file), "allow_296:begin", "allow_296:end")
        ),
        d_file=d_file,
        d_base=os.path.basename(d_file)[: -len(".up.sql")],
        d_block=d_block,
        d_tuples=count_tuples(d_block.split("\n")),
        # cfg_top: the highest config version, because later config migrations (306, 280) move the clean end state above R+1.
        cfg_top=max([0, *map(version_of, ups)]),
        a_file=a_file,
        a_base=os.path.basename(a_file)[: -len(".up.sql")],
        a_block=a_block,
        a_pairs=count_tuples(a_block.split("\n")),
    )


def split_assertions(names, r):
    """(config-NNN.sql below R, every other non-fixture file): the first describe the pre-R state."""
    pre, post = [], []
    for name in names:
        if fnmatch.fnmatchcase(name, "fixtures-*"):
            continue
        below_r = fnmatch.fnmatchcase(name, "config-[0-9]*") and (
            int(name[len("config-") : -len(".sql")]) < r
        )
        (pre if below_r else post).append(name)
    return pre, post


def assertion_names():
    return sorted(map(os.path.basename, glob.glob(os.path.join(ASSERTIONS, "*.sql"))))


def run_assertion(p, name):
    """The config-NNN.sql files read these GUCs because psql does not substitute :vars inside $$ bodies."""
    say(f"==> assertion: {name}")
    psql(
        "-v",
        f"seed_user_id={os.environ['SEED_USER_ID']}",
        "-v",
        f"allow_tuples={p.allow_tuples}",
        "-v",
        f"r_actor={p.r_actor}",
        "-v",
        f"r1_actor={p.r1_actor}",
        "-f",
        os.path.join(ASSERTIONS, name),
    )


def signed_copy(migration, tuples):
    """`migration` with the body of its allow_296 block replaced by the `tuples` lines."""
    out, skip = [], False
    for line in lines_of(migration):
        if "-- allow_296:begin" in line:
            out += [line, *tuples]
            skip = True
            continue
        if "-- allow_296:end" in line:
            skip = False
        if not skip:
            out.append(line)
    return "".join(line + "\n" for line in out)


def repo_sql(name, path=FORMULAS_REPO):
    """The body of a `NAME = \"\"\"` module constant."""
    body, inside = [], False
    for line in lines_of(read(path)):
        if inside:
            if line.startswith('"""'):
                break
            body.append(line)
        elif line.startswith(f'{name} = """'):
            inside = True
    return "\n".join(body).rstrip("\n")


def max_param(sql):
    """The highest $n of `sql`, '' when it binds none."""
    return str(max(map(int, PARAM.findall(sql)), default=""))


def check_params(name, expected, path=FORMULAS_REPO):
    """AC-11 must bind exactly the values it supplies."""
    sql = repo_sql(name, path)
    if not sql:
        fail(f"AC-11: {name} not found in {path}")
    n = max_param(sql)
    if n != str(expected):
        fail(f"AC-11: {name} has {n} params, harness supplies {expected}")


def line_of(text, pattern):
    for number, line in enumerate(lines_of(text), 1):
        if re.search(pattern, line):
            return number
    return None


def top_migration(md):
    """(version, base name) of the highest-numbered up-file in `md`; (0, '') without one above 000."""
    top, top_file = 0, ""
    for f in sorted(glob.glob(os.path.join(md, "*.up.sql"))):
        match = re.match(r"([0-9]*)_", os.path.basename(f))
        v = int(match.group(1) or 0) if match else 0
        if v > top:
            top, top_file = v, os.path.basename(f)[: -len(".up.sql")]
    return top, top_file


def pass_0():
    say("==> pass 0: migrate to the pre-224 versions and load fixtures")
    # `goto` on an already-migrated database would run down-files, so pass 0 needs a fresh one.
    if sql_value(FRESH_SQL) != "t":
        fail("expects a fresh database (indicators_schema_migrations already exists)")
    psql("-c", "CREATE EXTENSION IF NOT EXISTS timescaledb;")
    for schema in SCHEMAS:
        src = migrations_dir(schema)
        if not os.path.isdir(src):
            continue
        psql("-c", f"CREATE SCHEMA IF NOT EXISTS {schema};")
        if schema == "analysis":
            # Mirrors the db-migrate.sh `up` analysis-013 render (single-variable envsubst allowlist).
            seeded = tempfile.mkdtemp()
            for f in glob.glob(os.path.join(src, "*.sql")):
                shutil.copy(f, seeded)
            with open(os.path.join(src, "013_strategies_user_id.up.sql"), "rb") as f:
                sql = render_seed(f.read(), os.environ["SEED_USER_ID"].encode())
            with open(os.path.join(seeded, "013_strategies_user_id.up.sql"), "wb") as f:
                f.write(sql)
            src = seeded
        rendered = tempfile.mkdtemp()
        call([RENDER, src, rendered])
        say(f"  → {schema}")
        if schema in PRE_224:
            migrate(rendered, schema, "goto", PRE_224[schema])
        else:
            migrate(rendered, schema, "up")
        if schema == "analysis":
            analysis_rendered = rendered
    psql("-f", os.path.join(ASSERTIONS, "fixtures-pre-224.sql"))
    psql("-f", os.path.join(ASSERTIONS, "fixtures-pre-041.sql"))
    migrate(analysis_rendered, "analysis", "goto", "26")
    psql("-f", os.path.join(ASSERTIONS, "fixtures-post-224.sql"))


def knob_alive(label, run_a):
    if sql_test(KNOB_ALIVE_SQL) != "1":
        fail(f"AC-28 {label}: analysis/backtest.extra_knob was deleted")
    # Only re-runs after run_a count: the first run legitimately deletes the G2-signed twins.
    if sql_test(RERUN_DELETED_SQL.format(run_a=run_a)) != "0":
        fail(f"AC-28 {label}: a re-run deleted a row")


def pass_2b(p):
    """041-043 and the AC-28 legs run at cfg_pre = R-1: R would reject 041's replayed prefixed seeds (F-01)."""
    say(
        "==> pass 2b (AC-28): re-running config 041 never deletes a later-created key "
        f"(config at {p.cfg_pre}, before {p.r_base})"
    )
    # Config sits at 40 after pass 0: 041 (which creates config_heal_report_041) has not run yet.
    cfg_goto(p.cfg_pre)
    must_be_clean("config", p.cfg_pre)
    sql_value(KNOB_INSERT_SQL)

    say("  → (a) latch present: force 40 + goto is a no-op")
    run_a = sql_value(LATEST_RUN_SQL)
    counts_a = sql_value(COUNTS_SQL)
    cfg_force(40)
    cfg_goto(p.cfg_pre)
    must_be_clean("config", p.cfg_pre)
    knob_alive("(a)", run_a)
    if sql_test(LATEST_RUN_SQL) != run_a or sql_test(COUNTS_SQL) != counts_a:
        fail(
            "AC-28 (a): latched re-run changed rows/audit/report "
            f"({counts_a} -> {sql_test(COUNTS_SQL)})"
        )

    say("  → (b) latch deleted: force 40 + goto re-runs the heal")
    sql_value(LATCH_DELETE_SQL)
    cfg_force(40)
    cfg_goto(p.cfg_pre)
    must_be_clean("config", p.cfg_pre)
    knob_alive("(b)", run_a)
    if sql_test(LATEST_RUN_SQL) == run_a or sql_test(LATCH_COUNT_SQL) != "1":
        fail("AC-28 (b): the unlatched re-run did not run or did not re-latch")

    say(
        "  → (c) dirty at 41: the dirty guard refuses the automatic force 0 (contract floor 40)"
    )
    cfg_force(41)
    sql_value(CONFIG_DIRTY_SQL)
    counts_c = sql_value(COUNTS_SQL)
    fns_c = sql_value(FN_DEFS_SQL)
    rc, out = captured([DIRTY_GUARD, CFG_DIR, "config", "41 (dirty)"])
    if rc != 3:
        fail(f"AC-28 (c): the dirty guard exited {rc} at 41, want 3")
    must_contain(out, "config is dirty at version 41", "AC-28 (c)")
    must_contain(out, "force 40", "AC-28 (c)")
    if sql_test(COUNTS_SQL) != counts_c or sql_test(FN_DEFS_SQL) != fns_c:
        fail("AC-28 (c): the guard call changed rows or audit functions")
    cfg_force(40)
    cfg_goto(p.cfg_pre)
    must_be_clean("config", p.cfg_pre)
    knob_alive("(c)", run_a)
    if sql_test(COUNTS_SQL) != counts_c:
        fail("AC-28 (c): recovery changed rows/audit/report")


def signed_cmd(p, copy_dir, tuples, setup, asserts=None):
    """psql over R with its allow block replaced by `tuples`, inside the BEGIN that `setup` opens."""
    copy = os.path.join(copy_dir, "r_signed.sql")
    write(copy, signed_copy(read(p.r_file), tuples))
    files = [setup, copy] if asserts is None else [setup, copy, asserts]
    return psql_cmd(*(arg for f in files for arg in ("-f", f)))


def pass_2c(p):
    """Runs before pass 1 for the same reason as pass 2b; returns the sha256 of R as first applied."""
    say(
        f"==> pass 2c: pre-R config assertions, then the real-file AC-18/AC-19 test of {p.r_base}"
    )
    for name in split_assertions(assertion_names(), p.r)[0]:
        run_assertion(p, name)

    r_sha_before = sha256_of(p.r_file)
    counts_r = sql_value(COUNTS_SQL)
    rc, out = captured(migrate_cmd(CFG_DIR, "config", "up", "1"))
    if rc == 0:
        fail(f"AC-19: {p.r_base} applied over unsigned and secret-class twins")
    if not VIOLATION_HEADER.search(out):
        sys.stderr.write(out)
        fail(f"AC-19: {p.r_base} did not raise the feature-296 violation header")
    must_contain(out, "secret-class-twin marketdata/fmp.api_key/staging", "AC-18")
    must_contain(out, "uncovered-twin analysis/fundsignal.valid_days/staging", "AC-19")
    l_secret = line_of(out, "secret-class-twin marketdata/fmp.api_key/staging")
    l_unc = line_of(out, "uncovered-twin analysis/fundsignal.valid_days/staging")
    if not l_secret < l_unc:
        fail("AC-19: violation lines are not in rank order")
    # The message names keys only; the secret-class twin's plaintext must not appear anywhere in migrate's output
    # (which also echoes the migration SQL, so no looser heuristic is safe).
    if "legacy-fmp-value-295" in out:
        fail("AC-18/AC-19: the raise printed a value")
    must_be_dirty("config", p.r)
    if sql_test(COUNTS_SQL) != counts_r:
        fail(f"AC-19: the raised {p.r_base} changed rows, audit or report")
    if sql_test(REPORT_ABSENT_SQL) != "t":
        fail(f"AC-19: the raised {p.r_base} left report tables behind")
    if sql_test(MARKER_COUNT_SQL) != "0":
        fail(f"AC-19: the raised {p.r_base} set the marker")
    rc, out = captured([DIRTY_GUARD, CFG_DIR, "config", f"{p.r} (dirty)"])
    if rc != 3:
        fail(f"AC-19: the dirty guard exited {rc} at {p.r}, want 3")
    must_contain(out, f"force {p.cfg_pre}", "AC-19 dirty guard")

    say(
        "  → repair by hand (unread duplicates and the plaintext secret-class twin), "
        f"then converge with {p.r_base} unchanged"
    )
    psql(text=REPAIR_SQL)
    cfg_force(p.cfg_pre)

    copy_dir = tempfile.mkdtemp()
    say(
        f"  → signed-tuple happy path (AC-9, AC-16, AC-20, AC-21) on a copy of {p.r_base}, rolled back"
    )
    tuples = [
        "VALUES",
        f"  ('indicators', 'sandbox.timeout_ms', 'staging', NULL, {sha_of(5000)}),",
        f"  ('ledger', 'happy.equal', 'staging', NULL, {sha_of(7)}),",
        f"  ('ledger', 'ledger.happy.lone', 'staging', NULL, {sha_of(9)})",
    ]
    setup = temp_file(HAPPY_SETUP_SQL.format(ins_cols=INS_COLS))
    asserts = temp_file(HAPPY_ASSERTS_SQL.format(r_actor=p.r_actor))
    call(signed_cmd(p, copy_dir, tuples, setup, asserts))

    say("  → stale-signature and ambiguous-signature (AC-19), each rolled back")
    for mode, twin_key, tuples in (
        (
            "stale",
            "stale",
            ["VALUES", f"  ('ledger', 'happy.stale', 'staging', NULL, {sha_of(3)})"],
        ),
        (
            "ambiguous",
            "amb",
            [
                "VALUES",
                f"  ('ledger', 'happy.amb', 'staging', NULL, {sha_of(1)}),",
                f"  ('ledger', 'ledger.happy.amb', 'staging', NULL, {sha_of(2)})",
            ],
        ),
    ):
        setup = temp_file(TWIN_SETUP_SQL.format(ins_cols=INS_COLS, twin_key=twin_key))
        rc, out = captured(signed_cmd(p, copy_dir, tuples, setup))
        if rc == 0:
            fail(f"AC-19: a {mode}-signature twin was accepted")
        must_contain(out, f"{mode}-signature ledger/happy.{twin_key}/staging", "AC-19")
    return r_sha_before


def pass_1(p, r_sha_before):
    """Returns the LISTEN session and the N-1 trigger count after the apply."""
    say(
        f"==> pass 1: db-migrate.sh up (applies {p.r_base}, {p.r1_base} and {p.d_base})"
    )
    # AC-8: psql prints the notifications of the apply when the sleep query returns, so the sleep
    # must outlast pass 1; the session is waited on after pass 3.
    listener = subprocess.Popen(
        [
            "psql",
            os.environ["DATABASE_URL"],
            "-At",
            "-c",
            "LISTEN config_changed",
            "-c",
            "SELECT pg_sleep(240)",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    call([DB_MIGRATE, "up"])
    triggers_1 = sql_value(N1_TRIGGERS_SQL)
    if sha256_of(p.r_file) != r_sha_before:
        fail(f"AC-19: {p.r_base} changed between the failing run and the converged run")
    return listener, triggers_1


def render_one(schema, name, replay):
    """Render one migration file of `schema` into `replay`; returns the rendered path."""
    src = tempfile.mkdtemp()
    shutil.copy(os.path.join(migrations_dir(schema), name), src)
    call([RENDER, src, replay])
    return os.path.join(replay, name)


def pass_2(p, triggers_1):
    """Returns the rendered up-files of the dead-row and alias-removal migrations."""
    # Pre-224 up-files are not idempotent (docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md)
    # and applied migrations are immutable (F-01), so only the 224 expand and 225 contract up-files are replayed.
    say("==> pass 2: re-apply the feature-224/225 up-files on the migrated schema")
    replay = tempfile.mkdtemp()
    for schema, base in (*REPLAYS, ("config", p.r_base), ("config", p.r1_base)):
        rendered = render_one(schema, f"{base}.up.sql", replay)
        say(f"  → replay {schema}/{base}.up.sql")
        psql("-1", "-f", rendered)
    triggers_2 = sql_value(N1_TRIGGERS_SQL)

    if triggers_1 != "0" or triggers_2 != "0":
        fail(
            "expected 0 N-1 owner-fill triggers after the contract "
            f"(got {triggers_1} -> {triggers_2})"
        )

    # AC-6 (features 305, 306): the latch makes a replay of each row migration a no-op.
    ups = []
    for base in (p.d_base, p.a_base):
        up = render_one("config", f"{base}.up.sql", replay)
        fp_before = sql_value(FINGERPRINT_SQL)
        say(f"  → replay config/{base}.up.sql (latched: must change nothing)")
        psql("-1", "-f", up)
        if sql_test(FINGERPRINT_SQL) != fp_before:
            fail(
                f"AC-6: replaying {base} changed rows, audit, report, snapshot or markers"
            )
        ups.append(up)
    return ups


def pass_2d(p, d_up):
    say(
        "==> pass 2d (feature 305): the dead-row down restores exactly its rows and the up deletes them again"
    )
    # The signed block is a (VALUES ...) AS dead_rows_305(...) table expression; both files are applied directly
    # with psql (never migrate goto), so no later config migration's down runs here.
    d_live = D_LIVE_SQL.format(join=D_JOIN.format(block=p.d_block, alias="v"))
    d_live_signed = D_LIVE_SIGNED_SQL.format(
        join=D_JOIN.format(block=p.d_block, alias="v")
    )
    d_rest = D_REST_SQL.format(block=p.d_block)
    d_set_before = sql_value(D_MARKER_SQL)
    if not d_set_before:
        fail("pass 2d: the dead_rows_305 marker is absent before the down")
    if sql_test(d_live) != "0":
        fail("pass 2d: a signed row is still live after the up")
    d_rest_before = sql_value(d_rest)

    say(
        f"  → (a) down: {p.d_tuples} rows come back hashing to the signed shas, the latch clears, the restore is audited"
    )
    psql("-1", "-f", os.path.join(CFG_DIR, f"{p.d_base}.down.sql"))
    if sql_test(d_live_signed) != str(p.d_tuples):
        fail(
            f"pass 2d (a): the down did not restore {p.d_tuples} rows with the signed shas"
        )
    if sql_test(D_MARKER_SQL):
        fail("pass 2d (a): the down left the marker in place")
    if sql_test(D_RESTORE_AUDIT_SQL.format(actor=D_ACTOR)) != str(p.d_tuples):
        fail(
            f"pass 2d (a): the restore was not audited as {D_ACTOR} for {p.d_tuples} rows"
        )
    if sql_test(d_rest) != d_rest_before:
        fail("pass 2d (a): the down touched a row outside the signed tuples")

    say(
        "  → (b) AC-2: a signed tuple whose row no longer hashes is reported, not raised, and its row is kept (rolled back)"
    )
    psql("-v", f"upfile={d_up}", "-f", "-", text=DEAD_ROW_UNHASHED_SQL)
    if sql_test(d_live_signed) != str(p.d_tuples):
        fail("pass 2d (b): the rolled-back sub-test changed rows")
    if sql_test(D_MARKER_SQL):
        fail("pass 2d (b): the rolled-back sub-test left a marker")

    say(f"  → (c) up: the {p.d_tuples} rows are deleted again under a new marker run")
    psql("-1", "-f", d_up)
    d_set_after = sql_value(D_MARKER_SQL)
    if not d_set_after:
        fail("pass 2d (c): the up wrote no marker")
    later = MARKER_LATER_SQL.format(set_after=d_set_after, set_before=d_set_before)
    if sql_test(later) != "t":
        fail("pass 2d (c): the new marker is not later than the first run's")
    if sql_test(d_live) != "0":
        fail("pass 2d (c): a signed row is still live after the up")
    if sql_test(D_DELETED_SQL.format(set_after=d_set_after)) != str(p.d_tuples):
        fail(f"pass 2d (c): expected {p.d_tuples} dead-row-deleted rows")
    snapshot = SNAPSHOT_SQL.format(
        join=D_JOIN.format(block=p.d_block, alias="s"), set_after=d_set_after
    )
    if sql_test(snapshot) != str(p.d_tuples):
        fail(f"pass 2d (c): expected {p.d_tuples} snapshot rows")
    audit = DELETE_AUDIT_SQL.format(actor=D_ACTOR, set_after=d_set_after)
    if sql_test(audit) != str(p.d_tuples):
        fail(f"pass 2d (c): expected {p.d_tuples} delete audit rows")
    if sql_test(d_rest) != d_rest_before:
        fail("pass 2d (c): the up touched a row outside the signed tuples")


def pass_2e(p, a_up):
    say(
        "==> pass 2e (feature 306): the alias-removal down restores exactly its rows and the up deletes them again"
    )
    d_live = D_LIVE_SQL.format(join=D_JOIN.format(block=p.d_block, alias="v"))
    a_live = A_LIVE_SQL.format(join=A_JOIN.format(block=p.a_block, alias="v"))
    a_rest = A_REST_SQL.format(block=p.a_block)
    a_set_before = sql_value(A_MARKER_SQL)
    if not a_set_before:
        fail("pass 2e: the alias_removal_rows_306 marker is absent before the down")
    if sql_test(a_live) != "0":
        fail("pass 2e: a target row is still live after the up")
    a_deleted = sql_value(A_DELETED_SQL.format(set_at=a_set_before))
    if not 1 <= int(a_deleted) <= p.a_pairs * 2:
        fail(
            f"pass 2e: expected 1..{p.a_pairs * 2} alias-removal-row-deleted rows, got {a_deleted}"
        )
    a_rest_before = sql_value(a_rest)
    d_live_before = sql_value(d_live)

    say(
        f"  → (a) down: {a_deleted} rows come back, the latch clears, the restore is audited, 305's rows are not touched"
    )
    psql("-1", "-f", os.path.join(CFG_DIR, f"{p.a_base}.down.sql"))
    if sql_test(a_live) != a_deleted:
        fail(f"pass 2e (a): the down did not restore {a_deleted} rows")
    if sql_test(A_MARKER_SQL):
        fail("pass 2e (a): the down left the marker in place")
    if sql_test(A_RESTORE_AUDIT_SQL.format(actor=A_ACTOR)) != a_deleted:
        fail(
            f"pass 2e (a): the restore was not audited as {A_ACTOR} for {a_deleted} rows"
        )
    if sql_test(a_rest) != a_rest_before:
        fail("pass 2e (a): the down touched a row outside the target keys")
    if sql_test(d_live) != d_live_before:
        fail("pass 2e (a): the down resurrected a feature 305 row")

    say(
        "  → (b) a per-user row of a target key is kept and reported, not deleted (rolled back)"
    )
    psql("-v", f"upfile={a_up}", "-f", "-", text=ALIAS_PER_USER_SQL)
    if sql_test(a_live) != a_deleted:
        fail("pass 2e (b): the rolled-back sub-test changed rows")
    if sql_test(A_MARKER_SQL):
        fail("pass 2e (b): the rolled-back sub-test left a marker")

    say("  → (c) up: the rows are deleted again under a new marker run")
    psql("-1", "-f", a_up)
    a_set_after = sql_value(A_MARKER_SQL)
    if not a_set_after:
        fail("pass 2e (c): the up wrote no marker")
    later = MARKER_LATER_SQL.format(set_after=a_set_after, set_before=a_set_before)
    if sql_test(later) != "t":
        fail("pass 2e (c): the new marker is not later than the first run's")
    if sql_test(a_live) != "0":
        fail("pass 2e (c): a target row is still live after the up")
    if sql_test(A_DELETED_SQL.format(set_at=a_set_after)) != a_deleted:
        fail(f"pass 2e (c): expected {a_deleted} alias-removal-row-deleted rows")
    snapshot = SNAPSHOT_SQL.format(
        join=A_JOIN.format(block=p.a_block, alias="s"), set_after=a_set_after
    )
    if sql_test(snapshot) != a_deleted:
        fail(f"pass 2e (c): expected {a_deleted} snapshot rows")
    audit = DELETE_AUDIT_SQL.format(actor=A_ACTOR, set_after=a_set_after)
    if sql_test(audit) != a_deleted:
        fail(f"pass 2e (c): expected {a_deleted} delete audit rows")
    if sql_test(a_rest) != a_rest_before:
        fail("pass 2e (c): the up touched a row outside the target keys")


def refuse_down(schema, version, contract):
    """The contract down raises and leaves the state dirty."""
    say(f"  → {schema}: goto {version} must be refused by {contract}.down")
    rc, out = captured(
        migrate_cmd(migrations_dir(schema), schema, "goto", str(version))
    )
    if rc == 0:
        fail(f"{schema} goto {version} unexpectedly succeeded")
    must_contain(out, "irreversible contract", f"{schema} {contract} down")
    must_be_dirty(schema, version)


def guard_blocks(schema, dirty, recover):
    """db-migrate.sh up refuses force 0 while `schema` is dirty at `dirty`, then recover."""
    say(f"  → {schema}: db-migrate.sh up must refuse force 0 while dirty at {dirty}")
    rc, out = captured([DB_MIGRATE, "up"])
    if rc == 0:
        fail(f"db-migrate.sh up unexpectedly succeeded with {schema} dirty at {dirty}")
    must_contain(out, f"{schema} is dirty at version {dirty}", "dirty guard")
    must_contain(out, f"force {recover}", "dirty guard")
    must_be_dirty(schema, dirty)
    migrate(migrations_dir(schema), schema, "force", str(recover))


def pass_3(p):
    say("==> pass 3: contract downs are refused and the dirty guard blocks force 0")
    refuse_down("config", p.cfg_pre, p.r_base.split("_")[0])
    if sql_test(KEY_CHECK_SQL) != "0":
        fail("R+1: the refused down left the key CHECK in place")
    say(
        "  → gap rows a previous-image server writes between R and R+1 (staging, global)"
    )
    psql(text=GAP_ROWS_SQL)
    guard_blocks("config", p.cfg_pre, p.cfg_pre - 1)
    say("  → R+1: a mixed-class gap twin raises and changes nothing")
    cfg_force(p.r)
    counts_f = sql_value(COUNTS_SQL)
    rc, out = captured(migrate_cmd(CFG_DIR, "config", "up"))
    if rc == 0:
        fail("R+1: a mixed-class gap twin was accepted")
    must_contain(out, "mixed-class-gap-twin ledger/happy7.mixed/staging", "R+1")
    must_contain(out, "violation(s); nothing changed", "R+1")
    must_be_dirty("config", p.r1)
    if sql_test(COUNTS_SQL) != counts_f:
        fail("R+1: the raised CHECK migration changed rows or audit")
    sql_value(F7_REPAIR_SQL)
    cfg_force(p.r)

    refuse_down("ingest", 13, "014")
    if sql_test(DEDUP_ABSENT_SQL) != "t":
        fail("AC-13: ingest.signal_dedup_keys re-appeared after the refused down")
    guard_blocks("ingest", 13, 12)

    refuse_down("analysis", 26, "027")
    if sql_test(USER_ID_NULLABLE_SQL) != "NO":
        fail("AC-6: analysis.backtest_runs.user_id is nullable after the refused down")
    guard_blocks("analysis", 26, 25)

    say("  → recovery: db-migrate.sh up replays the contract and ends clean")
    call([DB_MIGRATE, "up"])
    for schema, want in (("ingest", 16), ("analysis", 29), ("config", p.cfg_top)):
        got = mig_version(schema)
        if got != str(want):
            fail(f"{schema} should be clean at {want}, got: {got}")

    for name in split_assertions(assertion_names(), p.r)[1]:
        run_assertion(p, name)


def ac_8(listener):
    say(
        "==> AC-8: the apply notified every touched (namespace, environment) and the marker"
    )
    heard = listener.communicate()[0].decode("utf-8", errors="replace")
    if '{"marker":"relative_keys_v1"}' not in heard:
        sys.stderr.write(heard)
        fail("AC-8: no marker notification was received")
    if '"namespace"' not in heard:
        fail("AC-8: no per-(namespace, environment) notification was received")


def pass_4():
    say(
        "==> pass 4: an older migrator skips a newer clean schema and refuses a newer dirty one"
    )
    old = tempfile.mkdtemp()
    os.mkdir(os.path.join(old, "scripts"))
    for name in OLD_MIGRATOR:
        shutil.copy(os.path.join(SCRIPTS_DIR, name), os.path.join(old, "scripts"))
    for schema in SCHEMAS:
        if os.path.isdir(migrations_dir(schema)):
            shutil.copytree(migrations_dir(schema), migrations_dir(schema, old))
    old_migrate = ["bash", os.path.join(old, "scripts/db-migrate.sh"), "up"]
    md = migrations_dir("marketdata", old)
    top, top_file = top_migration(md)
    if not top_file:
        fail("pass 4 needs a marketdata migration above 000")
    for f in glob.glob(os.path.join(md, f"{top_file}.*.sql")):
        os.remove(f)
    rc, out = captured(old_migrate)
    if rc != 0:
        sys.stderr.write(out)
        fail("pass 4 clean-ahead failed")
    must_contain(out, f"[ahead] marketdata is at version {top}", "pass 4 clean-ahead")
    if mig_version("marketdata") != str(top):
        fail(f"marketdata moved off {top}")
    psql("-c", MARKETDATA_DIRTY_SQL.format(dirty="true"))
    ahead_check = os.path.join(old, "scripts/migration-ahead-check.sh")
    rc = exit_status(
        subprocess.run(
            ["bash", ahead_check, md, "marketdata", mig_version("marketdata")],
            stderr=subprocess.DEVNULL,
            check=False,
        )
    )
    if rc != 4:
        fail(f"ahead check returned {rc}, want 4")
    rc, out = captured(old_migrate)
    if rc != 1:
        fail(f"old db-migrate.sh returned {rc} on dirty-ahead, want 1")
    must_contain(out, f"marketdata is dirty at version {top}", "pass 4 dirty-ahead")
    must_contain(out, f"force {top - 1}", "pass 4 dirty-ahead")
    if URL.search(out):
        fail("pass 4 printed a URL")
    must_be_dirty("marketdata", top)
    psql("-c", MARKETDATA_DIRTY_SQL.format(dirty="false"))
    call([DB_MIGRATE, "up"])
    shutil.rmtree(old)


def ac_11():
    check_params("_INSERT_SQL", 13)
    check_params("_UPDATE_SQL", 8)
    check_params("_UPSERT_SQL", 10)
    script = temp_file(
        AC11_HEAD_SQL
        + f"PREPARE ins AS {repo_sql('_INSERT_SQL')};\n"
        + AC11_INSERTS_SQL
        + f"PREPARE upd AS {repo_sql('_UPDATE_SQL')};\n"
        + AC11_UPDATE_SQL
        + f"PREPARE ups AS {repo_sql('_UPSERT_SQL')};\n"
        + AC11_UPSERTS_SQL
    )
    psql("-f", script)
    say("==> AC-11: indicators write SQL runs without is_public")


def main():
    for name in ("DATABASE_URL", "SEED_USER_ID"):
        if not os.environ.get(name):
            print(f"migration-rerun: {name} is required", file=sys.stderr)
            return 1
    p = discover(CFG_DIR)
    pass_0()
    pass_2b(p)
    r_sha_before = pass_2c(p)
    listener, triggers_1 = pass_1(p, r_sha_before)
    d_up, a_up = pass_2(p, triggers_1)
    pass_2d(p, d_up)
    pass_2e(p, a_up)
    pass_3(p)
    ac_8(listener)
    pass_4()
    ac_11()
    say(
        "==> migration-rerun: OK (replay idempotent, contract downs refused, dirty guard enforced, "
        "older migrator tolerates a newer schema)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
