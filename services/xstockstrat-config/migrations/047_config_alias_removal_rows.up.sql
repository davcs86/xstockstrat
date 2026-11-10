-- Service: xstockstrat-config - feature 306
-- Never edited after the sha is pinned (F-01): recovery repairs data, `migrate force n-1`, re-run. No lock, no data-dependent RAISE.
-- Deletes the three operator-decided config rows (global, non-secret, every environment); the marker latches replays.
-- Per-user and secret rows of the same keys are kept and reported.

WITH latch AS (
  SELECT NOT EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'alias_removal_rows_306') AS open
), target AS (
  SELECT * FROM
-- alias_removal_306:begin
(VALUES
  ('platform', 'log_level'),
  ('trading', 'risk.daily_loss_limit'),
  ('ledger', 'stream.notify_enabled')
) AS alias_removal_306(namespace, key)
-- alias_removal_306:end
), d AS (
  DELETE FROM config.config_values v
  USING target t, latch
  WHERE latch.open AND v.user_id IS NULL AND NOT v.is_secret
    AND v.namespace = t.namespace AND v.key = t.key
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
  SELECT d.namespace, d.key, d.value_data, NULL, 'system:config-migration-feature-306',
         'feature 306: delete alias-removal row', clock_timestamp(), d.environment, d.user_id, NULL
  FROM d
), rep AS (
  INSERT INTO config.config_keys_report_296 (run_at, action, namespace, key, environment, user_id, reason)
  SELECT now(), 'alias-removal-row-deleted', d.namespace, d.key, d.environment, d.user_id,
         'feature 306: operator-decided row deleted'
  FROM d
  UNION ALL
  SELECT now(), 'alias-removal-out-of-scope', v.namespace, v.key, v.environment, v.user_id,
         'feature 306: per-user or secret row left in place'
  FROM config.config_values v
  JOIN target t ON v.namespace = t.namespace AND v.key = t.key
  CROSS JOIN latch
  WHERE latch.open AND (v.user_id IS NOT NULL OR v.is_secret)
), mk AS (
  INSERT INTO config.config_markers (name, set_at, set_by)
  SELECT 'alias_removal_rows_306', now(), 'system:config-migration-feature-306'
  FROM latch
  WHERE latch.open
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) AS sent
  FROM (SELECT DISTINCT namespace, environment FROM d) t
)
SELECT (SELECT count(*) FROM d) AS deleted, (SELECT count(*) FROM nt) AS notified;
