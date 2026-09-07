-- Migration: 028_analysis_opportunity_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the 15 analysis.opportunity.* keys (feature 184) for staging + production.
--
-- SUPERSEDES the "analysis.* no-seed pattern": features 095/097/131/141/158/176/177 minted NO DB row
-- for these keys, so they were invisible/un-creatable in config-ui and un-tunable without a raw admin
-- SetConfig(create_key). This seeds them so config-ui shows them and an admin can tune them.
--
-- Each row is seeded at its CURRENT code default, so applying this migration is a NO-runtime-behavior
-- change: every reader resolves to exactly the value it used before.
--
-- The `key` column carries the FULL dotted key the analysis service reads
-- (cfgWatcher.get_int/get_int_present/get_float("analysis.opportunity.*")): the WatchConfig snapshot is
-- keyed by the `key` column with no namespace prefix added (configServiceImpl.ts values[row.key]), so
-- the seeded key must equal the read string. Mirrors 026/027's authoritative full-dotted form.
-- `value_type` must match each getter's storage type (float vs int) or the value silently returns the
-- default.
--
-- Scope (post feature 147): global (user_id NULL), one row per environment.
-- 10 of these keys additionally carry write-side SetConfig bounds in configServiceImpl.ts
-- SCALAR_BOUNDS_REGISTRY (feature 184); bounds are write-edge only and are not stored here. The 5
-- cadence/TTL/snooze keys are seeded UNBOUNDED (no documented failure mode).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'analysis.opportunity.max_universe_size', 'int', '100',
   'Max candidates traced per opportunity compute (feature 097); watchlist/held rank above the cut so a curated symbol is never truncated. Bounds [1,1000].',
   '100', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.max_universe_size', 'int', '100',
   'Max candidates traced per opportunity compute (feature 097); watchlist/held rank above the cut so a curated symbol is never truncated. Bounds [1,1000].',
   '100', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.valid_window_hours', 'int', '24',
   'valid_until = the compute session date + this window (feature 097). Bounds [1,168].',
   '24', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.valid_window_hours', 'int', '24',
   'valid_until = the compute session date + this window (feature 097). Bounds [1,168].',
   '24', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.snooze_default_hours', 'int', '24',
   'Default bounded "snooze until" when a SNOOZE carries no explicit timestamp (feature 097). Seeded unbounded.',
   '24', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.snooze_default_hours', 'int', '24',
   'Default bounded "snooze until" when a SNOOZE carries no explicit timestamp (feature 097). Seeded unbounded.',
   '24', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.signal_rank_weight', 'float', '0.3',
   'Weight w in [0,1] of the independent signal axis in the queue ORDER BY (feature 097): rank = (1-w)*conviction + w*signal_axis. Bounds [0,1]. 0 is not honored - reads as the 0.3 default (get_float).',
   '0.3', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.signal_rank_weight', 'float', '0.3',
   'Weight w in [0,1] of the independent signal axis in the queue ORDER BY (feature 097): rank = (1-w)*conviction + w*signal_axis. Bounds [0,1]. 0 is not honored - reads as the 0.3 default (get_float).',
   '0.3', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.refresh_hour_utc', 'int', '0',
   'Hour (UTC) of the configured daily opportunity refresh pass (feature 097/158) - a wall-clock refresh, not market close. Read presence-aware (0 = midnight is legitimate). Bounds [0,23].',
   '0', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.refresh_hour_utc', 'int', '0',
   'Hour (UTC) of the configured daily opportunity refresh pass (feature 097/158) - a wall-clock refresh, not market close. Read presence-aware (0 = midnight is legitimate). Bounds [0,23].',
   '0', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.startup_jitter_seconds', 'int', '30',
   'One-shot random delay [0,N] seconds at opportunity refresh loop entry to stagger concurrent redeploys (feature 158); read presence-aware - 0 disables jitter. Seeded unbounded.',
   '30', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.startup_jitter_seconds', 'int', '30',
   'One-shot random delay [0,N] seconds at opportunity refresh loop entry to stagger concurrent redeploys (feature 158); read presence-aware - 0 disables jitter. Seeded unbounded.',
   '30', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.retry_seconds', 'int', '300',
   'On a caught enumeration error the wall-clock blocked_until_ms advances by this many seconds, not to the next hour (feature 158); read presence-aware, clamped max(1,...) at read. Also read by the feature-180 readiness materializer loop. Seeded unbounded.',
   '300', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.retry_seconds', 'int', '300',
   'On a caught enumeration error the wall-clock blocked_until_ms advances by this many seconds, not to the next hour (feature 158); read presence-aware, clamped max(1,...) at read. Also read by the feature-180 readiness materializer loop. Seeded unbounded.',
   '300', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.max_live_strategies_per_symbol', 'int', '5',
   'Per-symbol cap (feature 131): how many live-enabled strategies may newly attribute to one symbol via live-coverage. Enforced only at candidate-creation. Bounds [1,50].',
   '5', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.max_live_strategies_per_symbol', 'int', '5',
   'Per-symbol cap (feature 131): how many live-enabled strategies may newly attribute to one symbol via live-coverage. Enforced only at candidate-creation. Bounds [1,50].',
   '5', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.max_live_only_symbols_per_compute', 'int', '20',
   'Cap (feature 131) on distinct non-held signal+live-covered symbols that get a new candidate row per compute pass. Composes multiplicatively with the per-symbol cap. Bounds [1,500].',
   '20', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.max_live_only_symbols_per_compute', 'int', '20',
   'Cap (feature 131) on distinct non-held signal+live-covered symbols that get a new candidate row per compute pass. Composes multiplicatively with the per-symbol cap. Bounds [1,500].',
   '20', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.max_live_held_symbols_per_compute', 'int', '20',
   'Cap (feature 131) on distinct held symbols that may receive a new live-only strategy attribution per compute pass; does not bound the held-row count itself. Bounds [1,500].',
   '20', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.max_live_held_symbols_per_compute', 'int', '20',
   'Cap (feature 131) on distinct held symbols that may receive a new live-only strategy attribution per compute pass; does not bound the held-row count itself. Bounds [1,500].',
   '20', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.max_concurrent_bars_fetches', 'int', '2',
   'Process-lifetime semaphore bounding cross-request concurrency of _compute_opportunities bars-fetch calls (feature 141, SEV-2 fix for TimescaleDB out-of-shared-memory). Read once in AnalysisServicer.__init__ (get_int, max(1,...)). Takes effect at service restart. Bounds [1,5] (ceiling = marketdata PgBouncer pool size).',
   '2', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.max_concurrent_bars_fetches', 'int', '2',
   'Process-lifetime semaphore bounding cross-request concurrency of _compute_opportunities bars-fetch calls (feature 141, SEV-2 fix for TimescaleDB out-of-shared-memory). Read once in AnalysisServicer.__init__ (get_int, max(1,...)). Takes effect at service restart. Bounds [1,5] (ceiling = marketdata PgBouncer pool size).',
   '2', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.max_concurrent_candidates', 'int', '4',
   'Bounds the per-candidate evaluate_conditions_traced fan-out in _compute_opportunities Phase 2 (feature 176), separate from max_concurrent_bars_fetches (priority-inversion guard). Read once in AnalysisServicer.__init__ (get_int, max(1,...)). Takes effect at service restart. Bounds [1,50].',
   '4', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.max_concurrent_candidates', 'int', '4',
   'Bounds the per-candidate evaluate_conditions_traced fan-out in _compute_opportunities Phase 2 (feature 176), separate from max_concurrent_bars_fetches (priority-inversion guard). Read once in AnalysisServicer.__init__ (get_int, max(1,...)). Takes effect at service restart. Bounds [1,50].',
   '4', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.sparkline_bars', 'int', '20',
   'Number of most-recent daily bar closes fetched per opportunity for the Decide-surface sparkline (feature 095). Read live per enrichment (get_int, max(1,...)). Bounds [1,500].',
   '20', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.sparkline_bars', 'int', '20',
   'Number of most-recent daily bar closes fetched per opportunity for the Decide-surface sparkline (feature 095). Read live per enrichment (get_int, max(1,...)). Bounds [1,500].',
   '20', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.empty_recompute_ttl_seconds', 'int', '30',
   'Empty-universe recompute suppression window (feature 177). Read via get_int_present. Seeded unbounded.',
   '30', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.empty_recompute_ttl_seconds', 'int', '30',
   'Empty-universe recompute suppression window (feature 177). Read via get_int_present. Seeded unbounded.',
   '30', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.opportunity.live_enrich_ttl_seconds', 'int', '10',
   'Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.',
   '10', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.opportunity.live_enrich_ttl_seconds', 'int', '10',
   'Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.',
   '10', 'xstockstrat-analysis', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
