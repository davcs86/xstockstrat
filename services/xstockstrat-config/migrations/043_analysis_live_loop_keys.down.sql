-- Migration: 043_analysis_live_loop_keys.down.sql
-- Service: xstockstrat-config, feature 293 (fix-analysis-live-loop-budget-seed).
-- Removes only global staging/production rows this migration inserted and nobody has rewritten since (SetConfig
-- overwrites updated_by), so 041's seeded rows, operator values and per-user overrides survive. Metadata stays.
-- The outer parentheses are load-bearing.

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-043'
  AND ((key = 'analysis.engine.max_strategies_per_cycle' AND value_data = '50')
    OR (key = 'analysis.engine.eval_interval_seconds' AND value_data = '60'));
