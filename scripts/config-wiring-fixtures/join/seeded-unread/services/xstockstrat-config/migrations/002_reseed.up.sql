INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ledger', 'stream.notify_enabled', 'bool', 'true', FALSE, 'no reader, later seed', 'true', 'xstockstrat-ledger', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
