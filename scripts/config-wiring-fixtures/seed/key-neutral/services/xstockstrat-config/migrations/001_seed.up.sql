INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'analysis.opportunity.signal_rank_weight', 'float',  '0.3', 'old', '0.3', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'signals.weights',                         'string', '{}',  'old', '{}',  'xstockstrat-analysis', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
