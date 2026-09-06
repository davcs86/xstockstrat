-- Migration: 027_analysis_readiness_materializer_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the four analysis.readiness_materializer.* keys (feature 182) for staging + production.
--
-- SUPERSEDES feature 180's no-seed/no-bounds registration of these same four keys: 180 minted no DB
-- row (the "analysis.* no-seed pattern"), so the keys were invisible/un-creatable in config-ui and the
-- readiness materializer could not be enabled without a raw admin SetConfig(create_key). This seeds
-- them so config-ui shows them and an admin can toggle `enabled`.
--
-- Each row is seeded at its CURRENT code default, so applying this migration is a NO-runtime-behavior
-- change: enabled='false' keeps the materializer OFF until an operator explicitly flips it.
--
-- The `key` column carries the FULL dotted key the analysis service reads
-- (cfgWatcher.get_bool/get_int_present/get_int("analysis.readiness_materializer.*")): the WatchConfig
-- snapshot is keyed by the `key` column with no namespace prefix added (configServiceImpl.ts
-- values[row.key]), so the seeded key must equal the read string. This mirrors
-- 026_analysis_engine_blend_keys's authoritative full-dotted form — NOT migration 019's namespace-
-- stripped `scoring.signal_decay_half_life_hours` form (that row is a latent reader-orphan, masked only
-- because its default==seeded value). `value_type` must match each getter (bool vs int) or the value
-- silently returns the default.
--
-- Scope (post feature 147): global (user_id NULL), one row per environment; the trading_mode axis was
-- removed by 017. Three of these keys additionally carry server-side SetConfig bounds in
-- configServiceImpl.ts SCALAR_BOUNDS_REGISTRY (feature 182: refresh_hour_utc [0,23],
-- valid_window_hours [1,168], max_concurrent_bars_fetches [1,5]); bounds are write-edge only and are
-- not stored here.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'analysis.readiness_materializer.enabled', 'bool', 'false',
   'Master kill-switch for the readiness materializer background loop (feature 180). Default OFF; an explicit operator true enables the daily pre-warm of the /insights/watchlists readiness cache. Read via get_bool (HasField).',
   'false', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.readiness_materializer.enabled', 'bool', 'false',
   'Master kill-switch for the readiness materializer background loop (feature 180). Default OFF; an explicit operator true enables the daily pre-warm of the /insights/watchlists readiness cache. Read via get_bool (HasField).',
   'false', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.readiness_materializer.refresh_hour_utc', 'int', '0',
   'Wall-clock UTC hour for the daily readiness re-warm (feature 180); dedicated anchor, decoupled from analysis.opportunity.refresh_hour_utc. Read presence-aware (0 = midnight is legitimate). Bounds [0,23].',
   '0', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.readiness_materializer.refresh_hour_utc', 'int', '0',
   'Wall-clock UTC hour for the daily readiness re-warm (feature 180); dedicated anchor, decoupled from analysis.opportunity.refresh_hour_utc. Read presence-aware (0 = midnight is legitimate). Bounds [0,23].',
   '0', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.readiness_materializer.valid_window_hours', 'int', '24',
   'Backstop TTL (hours) for a materialized readiness row''s valid_until (feature 180); the authoritative freshness bust is the bar_epoch-aware FAST gate, so this is only a floor. readiness_valid_until clamps to a 1h minimum. Bounds [1,168].',
   '24', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.readiness_materializer.valid_window_hours', 'int', '24',
   'Backstop TTL (hours) for a materialized readiness row''s valid_until (feature 180); the authoritative freshness bust is the bar_epoch-aware FAST gate, so this is only a floor. readiness_valid_until clamps to a 1h minimum. Bounds [1,168].',
   '24', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.readiness_materializer.max_concurrent_bars_fetches', 'int', '2',
   'The readiness materializer loop''s own bars-fetch semaphore (feature 180), separate from analysis.opportunity.max_concurrent_bars_fetches so a background pre-warm never starves interactive readiness; also throttles the feature-181 GetWatchlistReadiness on-read refresh kick (R-F). Never set 0 (get_int zero-trap collapses it to the default 2). Bounds [1,5] (ceiling = marketdata PgBouncer pool size, feature-141 SEV-2 guard).',
   '2', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.readiness_materializer.max_concurrent_bars_fetches', 'int', '2',
   'The readiness materializer loop''s own bars-fetch semaphore (feature 180), separate from analysis.opportunity.max_concurrent_bars_fetches so a background pre-warm never starves interactive readiness; also throttles the feature-181 GetWatchlistReadiness on-read refresh kick (R-F). Never set 0 (get_int zero-trap collapses it to the default 2). Bounds [1,5] (ceiling = marketdata PgBouncer pool size, feature-141 SEV-2 guard).',
   '2', 'xstockstrat-analysis', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
