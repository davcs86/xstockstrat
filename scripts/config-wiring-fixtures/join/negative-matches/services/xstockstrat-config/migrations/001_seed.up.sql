INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis',   'analysis.screener.max_duration_seconds', 'int',   '120',  FALSE, 'dotted seed',       '120',  'xstockstrat-analysis',   'staging', NULL),
  ('ui',         'performance.risk_free_rate_annual',       'float', '0.04', FALSE, 'ui bare by design', '0.04', 'xstockstrat-ui',         'staging', NULL),
  ('agent',      'signal.alert_threshold',                 'float', '0.6',  FALSE, 'agent bare',        '0.6',  'xstockstrat-agent',      'staging', NULL),
  ('trading',    'fill_poller.interval_ms',                'int',   '5000', FALSE, 'healed by 029',     '5000', 'xstockstrat-trading',    'staging', NULL),
  ('indicators', 'sandbox.timeout_ms',                     'int',   '5000', FALSE, 'healed by 031',     '5000', 'xstockstrat-indicators', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
