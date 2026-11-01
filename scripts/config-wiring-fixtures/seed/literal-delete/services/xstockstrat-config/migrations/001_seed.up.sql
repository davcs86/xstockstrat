INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis',  'signals.source_weights',              'string', '{}', 'dead',   '{}', 'xstockstrat-analysis',  'staging',    NULL),
  ('analysis',  'signals.source_weights',              'string', '{}', 'dead',   '{}', 'xstockstrat-analysis',  'production', NULL),
  ('portfolio', 'snapshot.interval_minutes',           'int',    '5',  'bare',   '5',  'xstockstrat-portfolio', 'staging',    NULL),
  ('portfolio', 'portfolio.snapshot.interval_minutes', 'int',    '1',  'dotted', '1',  'xstockstrat-portfolio', 'production', NULL),
  ('portfolio', 'portfolio.watchlist.max_per_user',    'int',    '10', 'kept',   '10', 'xstockstrat-portfolio', 'staging',    NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
