-- Migration: 027_analysis_readiness_materializer_keys.down.sql
-- Service: xstockstrat-config
-- Reverse 027: remove exactly the four analysis.readiness_materializer.* keys seeded by 027.up across
-- all environments. Global rows only (user_id IS NULL, matching the seed's scope) — this deliberately
-- preserves any per-user override an operator created after the seed (a tightening over 026's down,
-- which deleted all rows for the key). Explicit key IN (...) — never a LIKE 'readiness_materializer.%' —
-- so only what .up seeded is removed and no sibling analysis.* key is touched.

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND user_id IS NULL
  AND key IN (
    'analysis.readiness_materializer.enabled',
    'analysis.readiness_materializer.refresh_hour_utc',
    'analysis.readiness_materializer.valid_window_hours',
    'analysis.readiness_materializer.max_concurrent_bars_fetches'
  );
