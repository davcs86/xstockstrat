-- Migration: 057_marketdata_bars_miss_backoff.down.sql
-- Service: xstockstrat-config, feature fix-marketdata-miss-path-noise. A row an operator has changed is never deleted.

DELETE FROM config.config_values
WHERE namespace = 'marketdata'
  AND key = 'bars.miss_backoff_ms'
  AND environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-fix-marketdata-miss-path-noise'
  AND value_data = '1800000';
