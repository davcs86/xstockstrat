INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ledger', 'export.max_window_days', 'int',  '30',         FALSE, 'relative seed, read both ways',   '30',   'xstockstrat-ledger', 'staging',    NULL),
  ('ledger', 'export.max_window_days', 'int',  '30',         FALSE, 'relative seed, read both ways',   '30',   'xstockstrat-ledger', 'production', NULL),
  ('ledger', 'export.prod_only',       'int',  '1',          FALSE, 'production-only relative seed',   '1',    'xstockstrat-ledger', 'production', NULL),
  ('ledger', 'export.secret_token',    'string', '[redacted]', TRUE, 'secret row read prefixed',        NULL,   'xstockstrat-ledger', 'staging',    NULL),
  ('ledger', 'export.secret_token',    'string', '[redacted]', TRUE, 'secret row read prefixed',        NULL,   'xstockstrat-ledger', 'production', NULL),
  ('ledger', 'export.tmpl.alpha',      'int',  '5',          FALSE, 'prefix-catalog key read prefixed', '5',    'xstockstrat-ledger', 'staging',    NULL),
  ('ledger', 'export.tmpl.alpha',      'int',  '5',          FALSE, 'prefix-catalog key read prefixed', '5',    'xstockstrat-ledger', 'production', NULL),
  ('ledger', 'ledger.export.enabled',  'bool', 'true',       FALSE, 'prefixed seed, relative read',    'true', 'xstockstrat-ledger', 'staging',    NULL),
  ('ledger', 'ledger.export.enabled',  'bool', 'true',       FALSE, 'prefixed seed, relative read',    'true', 'xstockstrat-ledger', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
