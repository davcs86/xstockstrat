-- 003_fundsignal_runs.up.sql
-- Service: xstockstrat-analysis
-- Run-state / resumability + budget accounting for the fundamentals signal producer (feature 062).

CREATE TABLE IF NOT EXISTS analysis.fundsignal_runs (
  run_id         uuid PRIMARY KEY,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running',  -- running | completed | budget_deferred | failed
  symbols_total  int  NOT NULL DEFAULT 0,
  symbols_done   int  NOT NULL DEFAULT 0,
  calls_spent    int  NOT NULL DEFAULT 0,
  deferred_count int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fundsignal_runs_started_at
  ON analysis.fundsignal_runs (started_at DESC);
