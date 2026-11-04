-- Not a config-service migration: it creates a table and also inserts a config key.
CREATE TABLE IF NOT EXISTS analysis.fundsignal_runs (id BIGSERIAL PRIMARY KEY);

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'fundsignal.enabled', 'bool', 'false', FALSE, 'declared by migration', 'false', 'xstockstrat-analysis', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
