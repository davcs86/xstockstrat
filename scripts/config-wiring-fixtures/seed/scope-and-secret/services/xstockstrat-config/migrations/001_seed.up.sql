INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('notify',     'notify.fanout.enabled', 'bool',   'true',                FALSE, 'global row',   'true', 'xstockstrat-notify',     'staging', NULL),
  ('notify',     'notify.peruser.only',   'bool',   'true',                FALSE, 'per-user row', 'true', 'xstockstrat-notify',     'staging', 'user-123'),
  ('marketdata', 'vendor.api_key',        'string', 'TOPSECRET-VALUE-778', TRUE,  'secret row',   '',     'xstockstrat-marketdata', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
