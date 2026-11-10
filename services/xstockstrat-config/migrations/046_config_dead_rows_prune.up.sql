-- Service: xstockstrat-config - feature 305
-- Never edited after the P2 sha is pinned (F-01): recovery repairs data, `migrate force n-1`, re-run. No lock, no data-dependent RAISE.
-- Deletes the operator-signed dead config rows (global, non-secret, sha256 match); the marker latches replays.

WITH latch AS (
  SELECT NOT EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'dead_rows_305') AS open
), signed AS (
  SELECT * FROM
-- dead_rows_305:begin
(VALUES
  ('analysis', 'opportunity.sparkline_bars', 'production', 'f5ca38f748a1d6eaf726b8a42fb575c3c71f1864a8143301782de13da2d9202b'),
  ('analysis', 'opportunity.sparkline_bars', 'staging', 'f5ca38f748a1d6eaf726b8a42fb575c3c71f1864a8143301782de13da2d9202b'),
  ('marketdata', 'alpaca.paper', 'production', 'fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa'),
  ('marketdata', 'alpaca.paper', 'staging', 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b')
) AS dead_rows_305(namespace, key, environment, value_sha256)
-- dead_rows_305:end
), d AS (
  DELETE FROM config.config_values v
  USING signed s, latch
  WHERE latch.open AND v.user_id IS NULL AND NOT v.is_secret
    AND v.namespace = s.namespace AND v.key = s.key AND v.environment = s.environment
    AND encode(sha256(convert_to(v.value_data, 'UTF8')), 'hex') = s.value_sha256
  RETURNING v.id, v.namespace, v.key, v.value_type, v.value_data, v.is_secret, v.description, v.default_value,
            v.consuming_service, v.updated_by, v.update_reason, v.created_at, v.updated_at, v.environment,
            v.caller_identity, v.user_id
), snap AS (
  INSERT INTO config.config_values_premigration_296
    (id, namespace, key, value_type, value_data, is_secret, description, default_value,
     consuming_service, updated_by, update_reason, created_at, updated_at, environment,
     caller_identity, user_id, snapshot_at)
  SELECT d.id, d.namespace, d.key, d.value_type, d.value_data, d.is_secret, d.description, d.default_value,
         d.consuming_service, d.updated_by, d.update_reason, d.created_at, d.updated_at, d.environment,
         d.caller_identity, d.user_id, clock_timestamp()
  FROM d
), aud AS (
  INSERT INTO config.config_audit
    (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
  SELECT d.namespace, d.key, d.value_data, NULL, 'system:config-migration-feature-305',
         'feature 305: delete signed dead row', clock_timestamp(), d.environment, d.user_id, NULL
  FROM d
), rep AS (
  INSERT INTO config.config_keys_report_296 (run_at, action, namespace, key, environment, user_id, reason)
  SELECT now(), 'dead-row-deleted', d.namespace, d.key, d.environment, d.user_id,
         'feature 305: signed dead row deleted'
  FROM d
  UNION ALL
  SELECT now(), 'unmatched-signed-tuple', s.namespace, s.key, s.environment, NULL,
         'feature 305: signed tuple matched no row'
  FROM signed s, latch
  WHERE latch.open
    AND NOT EXISTS (SELECT 1 FROM d WHERE d.namespace = s.namespace AND d.key = s.key AND d.environment = s.environment)
), mk AS (
  INSERT INTO config.config_markers (name, set_at, set_by)
  SELECT 'dead_rows_305', now(), 'system:config-migration-feature-305'
  FROM latch
  WHERE latch.open
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) AS sent
  FROM (SELECT DISTINCT namespace, environment FROM d) t
)
SELECT (SELECT count(*) FROM d) AS deleted, (SELECT count(*) FROM nt) AS notified;
