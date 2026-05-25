-- Migration: 004_agent_config.up.sql
-- Service: xstockstrat-config
-- Adds agent.signal.alert_threshold config key (conviction threshold for auto-emit alert in ingest_signal)

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('agent', 'signal.alert_threshold', 'float', '0.6',
   'Minimum conviction score (0.0–1.0) for ingest_signal to auto-emit an alert via xstockstrat-notify.',
   '0.6', 'xstockstrat-agent', 'dev', 'all'),
  ('agent', 'signal.alert_threshold', 'float', '0.6',
   'Minimum conviction score (0.0–1.0) for ingest_signal to auto-emit an alert via xstockstrat-notify.',
   '0.6', 'xstockstrat-agent', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
