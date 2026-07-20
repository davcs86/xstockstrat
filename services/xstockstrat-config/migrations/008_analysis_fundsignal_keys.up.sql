-- Migration: 008_analysis_fundsignal_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the analysis.fundsignal.* config keys (feature 062) for dev + production.
-- NOTE: numbered 008 to keep the screener config-migration ordering 058->006, 059->007,
-- 062->008 (golang-migrate applies in numeric order; must merge after 006 and 007).
-- Keys are stored split (namespace 'analysis', key 'fundsignal.<rest>') matching how
-- 'signals.source_weights' is stored (003_analysis_signal_source_weights). enabled
-- defaults false so the producer stays dormant until upstream deps are live in the env.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('analysis', 'fundsignal.enabled', 'bool', 'false', 'Master gate for the daily fundamentals signal producer', 'false', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.enabled', 'bool', 'false', 'Master gate for the daily fundamentals signal producer', 'false', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.run_interval_hours', 'int', '24', 'Hours between producer cycles', '24', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.run_interval_hours', 'int', '24', 'Hours between producer cycles', '24', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.universe_source', 'string', 'watchlists', 'Universe source: watchlists | explicit | both', 'watchlists', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.universe_source', 'string', 'watchlists', 'Universe source: watchlists | explicit | both', 'watchlists', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.explicit_symbols', 'string', '', 'Comma-separated explicit symbol universe (used by explicit/both, or fallback)', '', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.explicit_symbols', 'string', '', 'Comma-separated explicit symbol universe (used by explicit/both, or fallback)', '', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.max_symbols_per_run', 'int', '200', 'Max symbols processed per producer cycle', '200', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.max_symbols_per_run', 'int', '200', 'Max symbols processed per producer cycle', '200', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.daily_call_budget', 'int', '200', 'Max cached-fundamentals fetch calls per day (<= marketdata.fmp.daily_request_cap, leaving headroom for the screener)', '200', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.daily_call_budget', 'int', '200', 'Max cached-fundamentals fetch calls per day (<= marketdata.fmp.daily_request_cap, leaving headroom for the screener)', '200', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.source_slug', 'string', 'fundamentals', 'Ingest signal source slug the producer emits under', 'fundamentals', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.source_slug', 'string', 'fundamentals', 'Ingest signal source slug the producer emits under', 'fundamentals', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.scoring_formula_id', 'string', '', 'Indicators formula id used to score fundamentals; empty = built-in default', '', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.scoring_formula_id', 'string', '', 'Indicators formula id used to score fundamentals; empty = built-in default', '', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.buy_quantile', 'float', '0.80', 'Cross-sectional score quantile at/above which direction is buy', '0.80', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.buy_quantile', 'float', '0.80', 'Cross-sectional score quantile at/above which direction is buy', '0.80', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.sell_quantile', 'float', '0.20', 'Cross-sectional score quantile at/below which direction is sell', '0.20', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.sell_quantile', 'float', '0.20', 'Cross-sectional score quantile at/below which direction is sell', '0.20', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.min_conviction_to_emit', 'float', '0.0', 'Minimum score required to emit a signal', '0.0', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.min_conviction_to_emit', 'float', '0.0', 'Minimum score required to emit a signal', '0.0', 'xstockstrat-analysis', 'production', 'all'),

  ('analysis', 'fundsignal.valid_days', 'int', '90', 'Days a produced signal stays valid (valid_until = run date + this)', '90', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'fundsignal.valid_days', 'int', '90', 'Days a produced signal stays valid (valid_until = run date + this)', '90', 'xstockstrat-analysis', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
