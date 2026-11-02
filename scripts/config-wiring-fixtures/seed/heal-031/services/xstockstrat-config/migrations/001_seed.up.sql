INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('indicators', 'sandbox.timeout_ms',              'int',    '5000',       FALSE, 'bare',                '5000',      'xstockstrat-indicators', 'staging',    NULL),
  ('indicators', 'sandbox.timeout_ms',              'int',    '3000',       FALSE, 'bare',                '3000',      'xstockstrat-indicators', 'production', NULL),
  ('indicators', 'sandbox.memory_bytes',            'int',    '134217728',  FALSE, 'bare twin',           '134217728', 'xstockstrat-indicators', 'staging',    NULL),
  ('indicators', 'indicators.sandbox.memory_bytes', 'int',    '134217728',  FALSE, 'dotted twin',         '134217728', 'xstockstrat-indicators', 'staging',    NULL),
  ('indicators', 'sandbox.max_concurrent',          'int',    '4',          FALSE, 'outside the IN list', '4',         'xstockstrat-indicators', 'staging',    NULL),
  ('indicators', 'sandbox.allowed_imports',         'string', '[redacted]', TRUE,  'secret, stays bare',  '',          'xstockstrat-indicators', 'staging',    NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
