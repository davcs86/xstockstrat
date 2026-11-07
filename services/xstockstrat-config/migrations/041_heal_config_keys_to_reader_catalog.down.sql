-- Migration: 041_heal_config_keys_to_reader_catalog.down.sql
-- Service: xstockstrat-config — feature 295
-- Restores only deleted twins (from each scope's latest twin-deleted run) and clears the latch; seeds,
-- retypes, metadata and both 041 tables stay, since they equal the reader catalog.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
   environment, user_id, updated_by, update_reason)
SELECT DISTINCT ON (s.namespace, s.key, s.environment, COALESCE(s.user_id, ''))
       s.namespace, s.key, s.value_type, s.value_data, s.is_secret, s.description, s.default_value,
       s.consuming_service, s.environment, s.user_id,
       'system:config-migration-041', 'feature 295: 041 down restores a deleted twin'
FROM config.config_heal_report_041 r
JOIN config.config_values_premigration_041 s
  ON s.namespace = r.namespace AND s.key = r.key AND s.environment = r.environment
 AND COALESCE(s.user_id, '') = COALESCE(r.user_id, '')
 AND s.updated_at <= r.run_at
WHERE r.action = 'twin-deleted' AND s.value_data IS NOT NULL
ORDER BY s.namespace, s.key, s.environment, COALESCE(s.user_id, ''), r.run_at DESC, s.updated_at DESC, s.id DESC
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

DELETE FROM config.config_heal_report_041 WHERE action = 'latch';
