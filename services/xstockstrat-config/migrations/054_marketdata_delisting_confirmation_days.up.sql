-- Migration: 054_marketdata_delisting_confirmation_days.up.sql
-- Service: xstockstrat-config, feature delisted-symbol-handling. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('marketdata', 'assets.delisting_confirmation_trading_days', 'int', '5',
   'Marketdata delisting detection: trading days a watchlist symbol must stay unservable in every successful asset-set load before it is flagged delisted. The first unservable day counts as day 1. Read at each asset-set load. A value above 30 reads as 30 and a value of 0 or less reads as 5.',
   '5', 'xstockstrat-marketdata', 'system:config-migration-feature-delisted-symbol-handling', 'staging', NULL),
  ('marketdata', 'assets.delisting_confirmation_trading_days', 'int', '5',
   'Marketdata delisting detection: trading days a watchlist symbol must stay unservable in every successful asset-set load before it is flagged delisted. The first unservable day counts as day 1. Read at each asset-set load. A value above 30 reads as 30 and a value of 0 or less reads as 5.',
   '5', 'xstockstrat-marketdata', 'system:config-migration-feature-delisted-symbol-handling', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
