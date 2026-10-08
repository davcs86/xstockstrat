-- Migration: 026_owner_dimension_templates.down.sql
-- backtest_runs.user_id backfill is intentionally kept: it is additive and harmless to N-1.
DROP TABLE IF EXISTS analysis.template_intents;
DROP TABLE IF EXISTS analysis.strategy_templates;
DROP TABLE IF EXISTS analysis.strategy_scores_v2;

ALTER TABLE analysis.strategies
    DROP COLUMN IF EXISTS origin_template_version,
    DROP COLUMN IF EXISTS origin_template_id;

DROP INDEX IF EXISTS analysis.idx_backtest_details_owner_strategy_completed;
DROP INDEX IF EXISTS analysis.idx_brs_owner_eligibility;

ALTER TABLE analysis.backtest_details DROP COLUMN IF EXISTS user_id;
ALTER TABLE analysis.backtest_run_symbols DROP COLUMN IF EXISTS user_id;
