-- Migration: 003_analysis_signal_source_weights.up.sql
-- Service: xstockstrat-config
-- Adds analysis.signals.source_weights config key (JSON string, per-source conviction multiplier)

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('analysis', 'signals.source_weights', 'string', '{}',
   'JSON object mapping signal source name to reliability weight in [0.0, 1.0]. Empty object means all sources use weight 1.0 (neutral).',
   '{}', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'signals.source_weights', 'string', '{}',
   'JSON object mapping signal source name to reliability weight in [0.0, 1.0]. Empty object means all sources use weight 1.0 (neutral).',
   '{}', 'xstockstrat-analysis', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
