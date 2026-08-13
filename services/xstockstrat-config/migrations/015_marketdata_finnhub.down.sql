-- Migration: 015_marketdata_finnhub.down.sql
-- Service: xstockstrat-config
-- Reverses 015_marketdata_finnhub.up.sql — removes the seeded Finnhub + provider-selector keys.

DELETE FROM config.config_values
 WHERE namespace = 'marketdata'
   AND key IN (
     'marketdata.finnhub.enabled',
     'marketdata.finnhub.base_url',
     'marketdata.finnhub.cache_ttl_hours',
     'marketdata.finnhub.symbols_per_minute',
     'marketdata.finnhub.rate_window_seconds',
     'marketdata.fundamentals.provider'
   );
