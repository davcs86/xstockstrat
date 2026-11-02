-- 031 sequence: snapshot, twin dedupe DELETE, literal-list prefix heal, ON CONFLICT insert, key-neutral UPDATE.
CREATE TABLE IF NOT EXISTS config.config_values_premigration_031 AS
SELECT id, namespace, key, value_type, value_data, is_secret, environment, user_id
FROM config.config_values
WHERE namespace = 'indicators' AND key LIKE '%sandbox.%';

DELETE FROM config.config_values b
WHERE b.namespace = 'indicators'
  AND b.key IN ('sandbox.timeout_ms', 'sandbox.memory_bytes', 'sandbox.allowed_imports')
  AND b.is_secret = false
  AND EXISTS (
    SELECT 1 FROM config.config_values t
    WHERE t.namespace = b.namespace
      AND t.key = 'indicators.' || b.key
      AND t.environment = b.environment
      AND COALESCE(t.user_id, '') = COALESCE(b.user_id, '')
  );

UPDATE config.config_values
SET key = namespace || '.' || key,
    value_data = CASE WHEN user_id IS NULL THEN
                   CASE key WHEN 'sandbox.timeout_ms' THEN '5000'
                            WHEN 'sandbox.memory_bytes' THEN '134217728'
                            ELSE 'numpy,pandas,math,statistics' END
                 ELSE value_data END,
    updated_by = 'system:config-migration-031',
    caller_identity = NULL
WHERE namespace = 'indicators'
  AND key IN ('sandbox.timeout_ms', 'sandbox.memory_bytes', 'sandbox.allowed_imports')
  AND is_secret = false;

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id,
   updated_by, update_reason)
VALUES
  ('indicators', 'indicators.sandbox.timeout_ms', 'int', '5000', 'Formula execution timeout ms', '5000',
   'xstockstrat-indicators', 'staging', NULL,
   'system:config-migration-031', 'heal'),
  ('indicators', 'indicators.sandbox.allowed_imports', 'string', 'numpy,pandas,math,statistics', 'Allowed imports',
   'numpy,pandas,math,statistics', 'xstockstrat-indicators', 'staging', NULL,
   'system:config-migration-031', 'heal')
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

UPDATE config.config_values
SET description = 'Formula memory headroom in bytes above the sandbox child''s baseline.',
    updated_by = 'system:config-migration-031',
    caller_identity = NULL
WHERE namespace = 'indicators'
  AND key = 'indicators.sandbox.memory_bytes'
  AND is_secret = false
  AND description IS DISTINCT FROM 'Formula memory headroom in bytes above the sandbox child''s baseline.';
