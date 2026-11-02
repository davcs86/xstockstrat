INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ingest', 'ingest.backfill.new_flag', 'bool', 'true', FALSE, 'seed leg', 'true', 'xstockstrat-ingest', 'staging',    NULL),
  ('ingest', 'ingest.backfill.new_flag', 'bool', 'true', FALSE, 'seed leg', 'true', 'xstockstrat-ingest', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
