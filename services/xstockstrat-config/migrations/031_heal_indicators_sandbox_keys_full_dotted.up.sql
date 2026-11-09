-- Migration: 031_heal_indicators_sandbox_keys_full_dotted.up.sql
-- Service: xstockstrat-config — feature 243

-- Snapshot omits the secret ciphertext column; the down keeps this table, and IF NOT EXISTS stops a
-- replay from replacing the pre-state.
CREATE TABLE IF NOT EXISTS config.config_values_premigration_031 AS
SELECT id, namespace, key, value_type, value_data, is_secret, description, default_value,
       consuming_service, updated_by, update_reason, created_at, updated_at, environment,
       caller_identity, user_id
FROM config.config_values
WHERE namespace = 'indicators' AND key LIKE '%sandbox.%';

-- A full-dotted twin in the same config_values_scope_uniq scope wins; renaming the bare row would
-- violate that index.
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

-- The CASE reads the pre-rename key. Per-user rows are only renamed: the indicators WatchConfig
-- request carries no user_id.
UPDATE config.config_values
SET key = namespace || '.' || key,
    value_data = CASE WHEN user_id IS NULL THEN
                   CASE key WHEN 'sandbox.timeout_ms' THEN '5000'
                            WHEN 'sandbox.memory_bytes' THEN '134217728'
                            ELSE 'numpy,pandas,math,statistics' END
                 ELSE value_data END,
    default_value = CASE WHEN user_id IS NULL THEN
                      CASE key WHEN 'sandbox.timeout_ms' THEN '5000'
                               WHEN 'sandbox.memory_bytes' THEN '134217728'
                               ELSE 'numpy,pandas,math,statistics' END
                    ELSE default_value END,
    updated_by = 'system:config-migration-031',
    update_reason = 'feature 243: heal bare sandbox seed key',
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
   'system:config-migration-031', 'feature 243: heal bare sandbox seed key'),
  ('indicators', 'indicators.sandbox.timeout_ms', 'int', '5000', 'Formula execution timeout ms', '5000',
   'xstockstrat-indicators', 'production', NULL,
   'system:config-migration-031', 'feature 243: heal bare sandbox seed key'),
  ('indicators', 'indicators.sandbox.memory_bytes', 'int', '134217728',
   'Formula memory headroom in bytes above the sandbox child''s measured pre-lockdown VmData baseline; RLIMIT_DATA = baseline + this value (feature 228).',
   '134217728', 'xstockstrat-indicators', 'staging', NULL,
   'system:config-migration-031', 'feature 243: heal bare sandbox seed key'),
  ('indicators', 'indicators.sandbox.memory_bytes', 'int', '134217728',
   'Formula memory headroom in bytes above the sandbox child''s measured pre-lockdown VmData baseline; RLIMIT_DATA = baseline + this value (feature 228).',
   '134217728', 'xstockstrat-indicators', 'production', NULL,
   'system:config-migration-031', 'feature 243: heal bare sandbox seed key'),
  ('indicators', 'indicators.sandbox.allowed_imports', 'string', 'numpy,pandas,math,statistics', 'Allowed imports',
   'numpy,pandas,math,statistics', 'xstockstrat-indicators', 'staging', NULL,
   'system:config-migration-031', 'feature 243: heal bare sandbox seed key'),
  ('indicators', 'indicators.sandbox.allowed_imports', 'string', 'numpy,pandas,math,statistics', 'Allowed imports',
   'numpy,pandas,math,statistics', 'xstockstrat-indicators', 'production', NULL,
   'system:config-migration-031', 'feature 243: heal bare sandbox seed key')
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

UPDATE config.config_values
SET description = 'Formula memory headroom in bytes above the sandbox child''s measured pre-lockdown VmData baseline; RLIMIT_DATA = baseline + this value (feature 228).',
    updated_by = 'system:config-migration-031',
    update_reason = 'feature 243: heal bare sandbox seed key',
    caller_identity = NULL
WHERE namespace = 'indicators'
  AND key = 'indicators.sandbox.memory_bytes'
  AND is_secret = false
  AND description IS DISTINCT FROM 'Formula memory headroom in bytes above the sandbox child''s measured pre-lockdown VmData baseline; RLIMIT_DATA = baseline + this value (feature 228).';
