-- Migration: 007_marketdata_fmp.down.sql
-- Service: xstockstrat-config
-- Reverses 007_marketdata_fmp.up.sql — removes the seeded FMP keys.

DELETE FROM config.config_values
 WHERE namespace = 'marketdata'
   AND key IN (
     'marketdata.fmp.enabled',
     'secret.marketdata.fmp.api_key',
     'marketdata.fmp.cache_ttl_hours',
     'marketdata.fmp.daily_request_cap',
     'marketdata.fmp.base_url',
     'marketdata.fmp.metrics'
   );
