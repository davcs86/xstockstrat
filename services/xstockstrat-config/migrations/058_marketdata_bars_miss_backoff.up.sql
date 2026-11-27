-- Migration: 058_marketdata_bars_miss_backoff.up.sql
-- Service: xstockstrat-config, feature fix-marketdata-miss-path-noise. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('marketdata', 'bars.miss_backoff_ms', 'int', '1800000',
   'Marketdata GetBars miss window: milliseconds a servable symbol with no stored bars is not live-fetched again by GetBars after a live fetch returned none. Read live on each miss. A value of 0 or less disables the back-off, so every miss fetches and warns. Explicit-range reads always fetch.',
   '1800000', 'xstockstrat-marketdata', 'system:config-migration-feature-fix-marketdata-miss-path-noise', 'staging', NULL),
  ('marketdata', 'bars.miss_backoff_ms', 'int', '1800000',
   'Marketdata GetBars miss window: milliseconds a servable symbol with no stored bars is not live-fetched again by GetBars after a live fetch returned none. Read live on each miss. A value of 0 or less disables the back-off, so every miss fetches and warns. Explicit-range reads always fetch.',
   '1800000', 'xstockstrat-marketdata', 'system:config-migration-feature-fix-marketdata-miss-path-noise', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
