INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ledger',   'stream.notify_enabled', 'bool', 'true',  FALSE, 'no reader',              'true',  'xstockstrat-ledger',   'staging',    NULL),
  ('ledger',   'stream.notify_enabled', 'bool', 'true',  FALSE, 'no reader',              'true',  'xstockstrat-ledger',   'production', NULL),
  ('analysis', 'fundsignal.enabled',    'bool', 'false', FALSE, 'bare seed, dotted read', 'false', 'xstockstrat-analysis', 'staging',    NULL),
  ('analysis', 'fundsignal.enabled',    'bool', 'false', FALSE, 'bare seed, dotted read', 'false', 'xstockstrat-analysis', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
