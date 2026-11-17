-- Migration: 054_marketdata_delisting_confirmation_days.down.sql
-- Service: xstockstrat-config, feature delisted-symbol-handling. A row an operator has changed is never deleted.

DELETE FROM config.config_values
WHERE namespace = 'marketdata'
  AND key = 'assets.delisting_confirmation_trading_days'
  AND environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-delisted-symbol-handling'
  AND value_data = '5';
