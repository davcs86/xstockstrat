-- Migration: 030_marketdata_edgar_snapshot_keys.down.sql
-- Service: xstockstrat-config
-- Reverse 030: remove exactly the 5 marketdata EDGAR-snapshot + dividend keys seeded by 030.up across
-- all environments. Global rows only (user_id IS NULL, matching the seed's scope) — preserves any
-- per-user override an operator created after the seed. Explicit key IN (...) — never a LIKE — so only
-- what .up seeded is removed and no sibling marketdata.* key (e.g. the feature-198 history keys or the
-- encrypted credential rows) is touched.

DELETE FROM config.config_values
WHERE namespace = 'marketdata'
  AND user_id IS NULL
  AND key IN (
    'marketdata.fundamentals.snapshot_source',
    'marketdata.edgar.enabled',
    'marketdata.edgar.cache_ttl_hours',
    'marketdata.dividends.enabled',
    'marketdata.dividends.backfill_lookback_years'
  );
