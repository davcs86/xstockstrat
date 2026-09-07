-- Migration: 028_analysis_opportunity_keys.down.sql
-- Service: xstockstrat-config
-- Reverse 028: remove exactly the 15 analysis.opportunity.* keys seeded by 028.up across all
-- environments. Global rows only (user_id IS NULL, matching the seed's scope) — preserves any per-user
-- override an operator created after the seed. Explicit key IN (...) — never a LIKE 'opportunity.%' —
-- so only what .up seeded is removed and no sibling analysis.* key is touched.

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND user_id IS NULL
  AND key IN (
    'analysis.opportunity.max_universe_size',
    'analysis.opportunity.valid_window_hours',
    'analysis.opportunity.snooze_default_hours',
    'analysis.opportunity.signal_rank_weight',
    'analysis.opportunity.refresh_hour_utc',
    'analysis.opportunity.startup_jitter_seconds',
    'analysis.opportunity.retry_seconds',
    'analysis.opportunity.max_live_strategies_per_symbol',
    'analysis.opportunity.max_live_only_symbols_per_compute',
    'analysis.opportunity.max_live_held_symbols_per_compute',
    'analysis.opportunity.max_concurrent_bars_fetches',
    'analysis.opportunity.max_concurrent_candidates',
    'analysis.opportunity.sparkline_bars',
    'analysis.opportunity.empty_recompute_ttl_seconds',
    'analysis.opportunity.live_enrich_ttl_seconds'
  );
