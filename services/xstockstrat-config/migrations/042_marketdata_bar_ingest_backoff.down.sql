-- Migration: 042_marketdata_bar_ingest_backoff.down.sql
-- Reverses 042_marketdata_bar_ingest_backoff.up.sql (removes marketdata.stream.bar_ingest_backoff_ms across all environments and any per-user override).

DELETE FROM config.config_values
 WHERE namespace = 'marketdata'
   AND key = 'marketdata.stream.bar_ingest_backoff_ms';
