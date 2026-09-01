-- Migration: 026_analysis_engine_blend_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the two analysis.engine.fundamentals_blend_* keys (feature 168, fundamentals-blend-universe)
-- for staging + production.
--
-- The `key` column carries the FULL dotted key the analysis service reads
-- (cfgWatcher.get_str/get_bool("analysis.engine.fundamentals_blend_*")): the WatchConfig snapshot is
-- keyed by the `key` column with no namespace prefix added (configServiceImpl.ts values[row.key]), so
-- the seeded key must equal the read string. This mirrors 021_notify_push_min_severity's authoritative
-- full-dotted form — NOT 008_analysis_fundsignal_keys's older split `fundsignal.*` form (008 predates
-- the feature-147 schema; its default==seeded values masked the mismatch). `namespace` stays `analysis`.
--
-- NNN renumbered 024 -> 026. merge-order.md pre-assigned 024 (021→022, 031→023, 168→024, 166→025),
-- but feature 166's 025_ingest_mcp_client_keys merged into main-dev FIRST (PR #1063), so a 024 arriving
-- afterward would sit below the already-applied 025 and golang-migrate (migrate up runs only versions >
-- current) would never apply it on the persistent dev/prod DBs. 026 (next free after 025) restores
-- forward-only ordering; the skipped 024 is a permanent, harmless gap (golang-migrate allows gaps).
--
-- Scope (post feature 147): global (user_id NULL), one row per environment; the trading_mode axis was
-- removed by 017 — do not reintroduce the 'all' form used by 008. value_type 'bool'/'string' must match
-- the reader getter (get_bool/get_str) or the value silently returns the default.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'analysis.engine.fundamentals_blend_strategy_id', 'string', 'fundamentals_macd_blend',
   'Strategy id the fundamentals-universe force-run rule governs (feature 168). When this strategy is live, it is evaluated over the fundamentals universe (signals from the fundamentals source ∩ symbols with actual fundamentals), minus denied symbols. Empty reverts to the code default fundamentals_macd_blend.',
   'fundamentals_macd_blend', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.engine.fundamentals_blend_strategy_id', 'string', 'fundamentals_macd_blend',
   'Strategy id the fundamentals-universe force-run rule governs (feature 168). When this strategy is live, it is evaluated over the fundamentals universe (signals from the fundamentals source ∩ symbols with actual fundamentals), minus denied symbols. Empty reverts to the code default fundamentals_macd_blend.',
   'fundamentals_macd_blend', 'xstockstrat-analysis', 'production', NULL),
  ('analysis', 'analysis.engine.fundamentals_blend_enabled', 'bool', 'true',
   'Kill-switch for the fundamentals-universe force-run (feature 168). Independent of whether the blend strategy is live: false disables the universe override entirely (the strategy then resolves its own universe like any other). Default true; an explicit operator false is honored (HasField-based read).',
   'true', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'analysis.engine.fundamentals_blend_enabled', 'bool', 'true',
   'Kill-switch for the fundamentals-universe force-run (feature 168). Independent of whether the blend strategy is live: false disables the universe override entirely (the strategy then resolves its own universe like any other). Default true; an explicit operator false is honored (HasField-based read).',
   'true', 'xstockstrat-analysis', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
