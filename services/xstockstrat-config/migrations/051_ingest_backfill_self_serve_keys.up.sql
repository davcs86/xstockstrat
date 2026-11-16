-- Migration: 051_ingest_backfill_self_serve_keys.up.sql
-- Service: xstockstrat-config, feature backtest-inline-backfill. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('ingest', 'backfill.self_serve_max_range_days', 'int', '730',
   'The longest range in days a non-admin may request in one backfill. 730 covers a 200-bar warm-up plus a one-year backtest window, and a 1000-bar warm-up needs 1830. Raising it lets every signed-in user spend more vendor quota per request. A stored value of 0 or less reads as the default.',
   '730', 'xstockstrat-ingest', 'system:config-migration-feature-backtest-inline-backfill', 'staging', NULL),
  ('ingest', 'backfill.self_serve_max_range_days', 'int', '730',
   'The longest range in days a non-admin may request in one backfill. 730 covers a 200-bar warm-up plus a one-year backtest window, and a 1000-bar warm-up needs 1830. Raising it lets every signed-in user spend more vendor quota per request. A stored value of 0 or less reads as the default.',
   '730', 'xstockstrat-ingest', 'system:config-migration-feature-backtest-inline-backfill', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
