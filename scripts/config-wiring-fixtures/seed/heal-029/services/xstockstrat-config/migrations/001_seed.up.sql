INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('trading',    'risk.max_position_pct', 'float',  '0.05',       FALSE, 'bare, in list',        '0.05', 'xstockstrat-trading',    'staging', NULL),
  ('platform',   'platform.log_level',    'string', 'info',       FALSE, 'already dotted',       'info', 'all',                    'staging', NULL),
  ('marketdata', 'alpaca.api_key',        'string', '[redacted]', TRUE,  'secret, stays bare',   '',     'xstockstrat-marketdata', 'staging', NULL),
  ('ledger',     'stream.notify_enabled', 'bool',   'true',       FALSE, 'namespace not listed', 'true', 'xstockstrat-ledger',     'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
