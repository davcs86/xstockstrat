INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ingest', 'ingest.alpha.enabled', 'bool', 'true', FALSE, 'production only', 'true', 'xstockstrat-ingest', 'production', NULL),
  ('ingest', 'ingest.beta.enabled',  'bool', 'true', FALSE, 'both envs',       'true', 'xstockstrat-ingest', 'production', NULL),
  ('ingest', 'ingest.beta.enabled',  'bool', 'true', FALSE, 'both envs',       'true', 'xstockstrat-ingest', 'staging',    NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
