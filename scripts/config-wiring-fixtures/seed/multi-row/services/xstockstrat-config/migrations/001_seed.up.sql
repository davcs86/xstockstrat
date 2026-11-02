INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  -- comment inside VALUES; with a quote ' and a ; that are not code
  ('analysis', 'analysis.k1', 'int', '1', 'it''s a description -- not a comment; not a split', '1', 'xstockstrat-analysis', 'staging',    'paper'),
  ('analysis', 'analysis.k1', 'int', '1', 'production row (a, b)',                              '1', 'xstockstrat-analysis', 'production', 'all'),
  ('analysis', 'analysis.k1', 'int', '2', 'duplicate staging row, other mode',                  '2', 'xstockstrat-analysis', 'staging',    'live'),
  ('analysis', 'analysis.k2', 'int', '3', 'second key',                                         '3', 'xstockstrat-analysis', 'staging',    'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'analysis.k2', 'int', '9', 'conflicting re-insert', '9', 'xstockstrat-analysis', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
