-- config 044 (AC-1, AC-3, AC-4, AC-8, AC-15, AC-16, AC-17, AC-19, AC-20, AC-21): run by migration-rerun.sh after pass 3.
-- Asserts the rename migration R and the CHECK migration R+1 over the pass 1-3 data (fixtures-pre-041, the pass 2c
-- repair, and the staging gap rows F1-F6 that pass 3 inserts). The number follows R: rename this file with R.
-- psql does not substitute variables inside $$ bodies, so they are passed through session GUCs.
SELECT set_config('app.r_actor', :'r_actor', false) AS r_actor \gset
SELECT set_config('app.r1_actor', :'r1_actor', false) AS r1_actor \gset
SELECT set_config('app.allow_tuples', :'allow_tuples', false) AS allow_tuples \gset

-- AC-1 / AC-15: the key CHECK exists and rejects a prefixed row on a direct insert.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_values_key_relative_check'
                   AND conrelid = 'config.config_values'::regclass) THEN
    RAISE EXCEPTION 'AC-15: config_values_key_relative_check is missing';
  END IF;
  BEGIN
    INSERT INTO config.config_values (namespace, key, value_type, value_data)
    VALUES ('marketdata', 'marketdata.backfill.batch_size', 'int', '1');
    RAISE EXCEPTION 'AC-1: a prefixed row was accepted by the database';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- AC-8: nothing prefixed remains, the marker is set by R, the snapshot precedes the rename audit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_values WHERE left(key, length(namespace) + 1) = namespace || '.') THEN
    RAISE EXCEPTION 'AC-8: a prefixed key remains after R and R+1';
  END IF;
  IF (SELECT set_by FROM config.config_markers WHERE name = 'relative_keys_v1')
       IS DISTINCT FROM current_setting('app.r_actor') THEN
    RAISE EXCEPTION 'AC-8: marker relative_keys_v1 is missing or not set by %', current_setting('app.r_actor');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM config.config_values_premigration_296 s
      JOIN config.config_audit a
        ON a.changed_by = current_setting('app.r_actor') AND a.reason LIKE 'feature 296: renamed from %'
       AND a.namespace = s.namespace AND a.environment = s.environment
       AND a.key = substr(s.key, length(s.namespace) + 2)
     WHERE s.snapshot_at < a.changed_at) THEN
    RAISE EXCEPTION 'AC-8: no snapshot row precedes its rename audit row';
  END IF;
END $$;

-- AC-3 / AC-4 / AC-16: every renamed row keeps its value, author and last-modified time; the two named keys are relative.
-- A later legitimate write (a replayed seed) stamps updated_at after the snapshot, so only rows still stamped at or
-- before their snapshot are compared.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_values v
               JOIN config.config_values_premigration_296 s ON s.id = v.id
              WHERE v.updated_at <= s.snapshot_at
                AND (v.updated_at IS DISTINCT FROM s.updated_at
                  OR v.updated_by IS DISTINCT FROM s.updated_by
                  OR (NOT v.is_secret AND v.value_data IS DISTINCT FROM s.value_data))) THEN
    RAISE EXCEPTION 'AC-3/AC-16: a renamed row changed value, updated_by or updated_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'indicators' AND key = 'sandbox.timeout_ms'
                  AND environment = 'staging' AND user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-3: indicators/sandbox.timeout_ms is not stored relative';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'trading' AND key = 'risk.bracket_orders_enabled'
                  AND environment = 'staging' AND user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-4: trading/risk.bracket_orders_enabled is not stored relative';
  END IF;
END $$;

-- AC-17: gap-twin outcomes F1-F6 (newest write wins; NULL or system author loses; secrets resolve with NULL audit values).
DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN SELECT * FROM (VALUES
      ('analysis', 'backtest.extra_knob', '2', 'migration-rerun-operator', NULL),
      ('platform', 'trading_state', 'REDUCE_ONLY', 'trading-reconciliation-poller', 'trading-reconciliation-poller'),
      ('analysis', 'backtest.null_knob', '3', 'migration-rerun', NULL),
      ('analysis', 'backtest.seed_knob', '3', 'migration-rerun', NULL),
      ('analysis', 'backtest.keep_knob', '7', 'migration-rerun', NULL)
    ) AS t(ns, k, val, by, ident) LOOP
    IF NOT EXISTS (SELECT 1 FROM config.config_values
                    WHERE namespace = w.ns AND key = w.k AND environment = 'staging' AND user_id IS NULL
                      AND value_data = w.val AND updated_by = w.by AND caller_identity IS NOT DISTINCT FROM w.ident) THEN
      RAISE EXCEPTION 'AC-17: %/% does not hold %, author %, caller %', w.ns, w.k, w.val, w.by, w.ident;
    END IF;
  END LOOP;
  -- Winners F1 and F2: exactly one delete-audit and one rename-audit row, delete before rename.
  FOR w IN SELECT * FROM (VALUES ('analysis', 'backtest.extra_knob'), ('platform', 'trading_state')) AS t(ns, k) LOOP
    IF (SELECT count(*) FROM config.config_audit WHERE namespace = w.ns AND key = w.k
          AND changed_by = current_setting('app.r1_actor') AND new_value IS NULL
          AND reason LIKE 'feature 296: gap twin, superseded%') <> 1
       OR (SELECT count(*) FROM config.config_audit WHERE namespace = w.ns AND key = w.k
          AND changed_by = current_setting('app.r1_actor') AND reason LIKE 'feature 296: renamed from %') <> 1
       OR (SELECT max(id) FROM config.config_audit WHERE namespace = w.ns AND key = w.k
             AND changed_by = current_setting('app.r1_actor') AND new_value IS NULL AND reason LIKE 'feature 296: gap twin%')
          > (SELECT min(id) FROM config.config_audit WHERE namespace = w.ns AND key = w.k
             AND changed_by = current_setting('app.r1_actor') AND reason LIKE 'feature 296: renamed from %') THEN
      RAISE EXCEPTION 'AC-17: %/% needs one delete-audit row before one rename-audit row', w.ns, w.k;
    END IF;
  END LOOP;
  -- Report rows per outcome: F1, F2, F6 -> p-wins; F5 -> rel-won; F3, F4 -> system-deleted.
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'gap-twin-p-wins') < 3
     OR (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'gap-twin-rel-won') < 1
     OR (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'gap-twin-system-deleted') < 2 THEN
    RAISE EXCEPTION 'AC-17: gap-twin report rows are missing';
  END IF;
  -- F6: the both-secret twin resolved to one relative row, with no value in any audit row.
  IF (SELECT count(*) FROM config.config_values WHERE namespace = 'ledger' AND key IN ('happy6.sealed', 'ledger.happy6.sealed')) <> 1
     OR NOT EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'ledger' AND key = 'happy6.sealed' AND is_secret)
     OR EXISTS (SELECT 1 FROM config.config_audit WHERE namespace = 'ledger' AND key = 'happy6.sealed'
                  AND changed_by = current_setting('app.r1_actor') AND (old_value IS NOT NULL OR new_value IS NOT NULL)) THEN
    RAISE EXCEPTION 'AC-17: the both-secret gap twin was not resolved to one relative row with NULL audit values';
  END IF;
  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'config_value_audit') IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'AC-17: the audit trigger config_value_audit is not enabled';
  END IF;
END $$;

-- AC-19: the by-hand repair left its audit row (the migration file itself was never edited).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config.config_audit WHERE changed_by = 'migration-rerun' AND reason LIKE 'AC-19 repair%') THEN
    RAISE EXCEPTION 'AC-19: the repair audit row is missing';
  END IF;
END $$;

-- AC-20: the per-user row 041 reported unread is parked with its value in the snapshot, listed without a value.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_values WHERE namespace = 'analysis' AND key = 'fundsignal.enabled' AND user_id = 'u-295') THEN
    RAISE EXCEPTION 'AC-20: the per-user row of u-295 is still in config_values';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values_premigration_296 WHERE namespace = 'analysis'
                  AND key = 'fundsignal.enabled' AND user_id = 'u-295' AND value_data = 'true') THEN
    RAISE EXCEPTION 'AC-20: the parked per-user row is missing from the snapshot table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_keys_report_296 WHERE action = 'per-user-parked' AND namespace = 'analysis'
                  AND user_id = 'u-295') THEN
    RAISE EXCEPTION 'AC-20: no per-user-parked report row for u-295';
  END IF;
END $$;

-- AC-21: R reports exactly one unmatched-signed-tuple row per tuple in its rendered allow block (0 until the
-- operator pastes the signed block, 5 after); the count is compared outside any $$ body.
SELECT (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'unmatched-signed-tuple')
       = current_setting('app.allow_tuples')::int AS unmatched_ok \gset
\if :unmatched_ok
\else
  \echo 'AC-21: the unmatched-signed-tuple report count differs from the allow_296 tuple count'
  SELECT 1 / 0;
\endif
