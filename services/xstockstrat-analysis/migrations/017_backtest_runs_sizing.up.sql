-- Feature 150: record the sizing model + resolved allocation params each run used, so a run is
-- reproducible despite WatchConfig drift. All NULLABLE: pre-150 rows legitimately have no value.
ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS sizing_mode TEXT;
ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS position_weight DOUBLE PRECISION;
ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS max_concurrent INTEGER;
