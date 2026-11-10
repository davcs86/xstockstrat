-- Service: xstockstrat-config - feature 306
-- Restores only the rows the marker's run deleted (global, from their snapshot images), notifies, and clears the latch.

WITH mk AS (
  DELETE FROM config.config_markers WHERE name = 'alias_removal_rows_306' RETURNING set_at
), ins AS (
  INSERT INTO config.config_values
    (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
     environment, user_id, updated_by, update_reason)
  SELECT DISTINCT ON (s.namespace, s.key, s.environment)
         s.namespace, s.key, s.value_type, s.value_data, s.is_secret, s.description, s.default_value,
         s.consuming_service, s.environment, s.user_id,
         'system:config-migration-feature-306', 'feature 306: down restores an alias-removal row'
  FROM mk
  JOIN config.config_keys_report_296 r ON r.run_at = mk.set_at AND r.action = 'alias-removal-row-deleted'
  JOIN config.config_values_premigration_296 s
    ON s.namespace = r.namespace AND s.key = r.key AND s.environment = r.environment
   AND s.user_id IS NULL AND s.snapshot_at >= r.run_at AND s.value_data IS NOT NULL
  ORDER BY s.namespace, s.key, s.environment, s.snapshot_at ASC
  ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING
  RETURNING namespace, environment
)
SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text)
FROM (SELECT DISTINCT namespace, environment FROM ins) t;
