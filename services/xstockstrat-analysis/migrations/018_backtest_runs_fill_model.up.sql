-- Feature 151: record the fill model each run used, so a run is reproducible despite WatchConfig
-- drift. NULLABLE: pre-151 rows legitimately have no value. Stores the enum NAME (mirrors status).
ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS fill_model TEXT;
