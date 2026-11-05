-- 001 narrow column list: environment comes from the 002 column DEFAULT 'dev'.
INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service) VALUES
  ('ledger',   'stream.notify_enabled', 'bool', 'true',  'Enable pg NOTIFY streaming',   'true',  'xstockstrat-ledger'),
  ('platform', 'maintenance_mode',      'bool', 'false', 'Halts all trading operations', 'false', 'all')
ON CONFLICT (namespace, key) DO NOTHING;

-- 002 production re-insert with the since-dropped trading_mode column.
INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode) VALUES
  ('platform', 'maintenance_mode', 'bool', 'false', 'Halts all trading operations', 'false', 'all', 'production', 'live'),
  ('platform', 'maintenance_mode', 'bool', 'true',  'Halts all trading operations', 'true',  'all', 'production', 'paper')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
