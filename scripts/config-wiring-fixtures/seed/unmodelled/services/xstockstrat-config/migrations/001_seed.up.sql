INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('notify', 'notify.fanout.enabled', 'bool', 'true', 'fan-out toggle', 'true', 'xstockstrat-notify', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
