-- 004_fundsignal_emitted.up.sql
-- Service: xstockstrat-analysis
-- Idempotency guard (FR-5): at-most-one fundamentals signal per (symbol, source, as_of_date).
-- Ingest's IngestSignal has no UNIQUE constraint, so analysis owns dedup.

CREATE TABLE IF NOT EXISTS analysis.fundsignal_emitted (
  symbol      text   NOT NULL,
  source      text   NOT NULL,
  as_of_date  date   NOT NULL,
  signal_id   bigint,            -- the int64 returned by IngestSignalResponse.signal_id
  score       numeric,
  direction   text,              -- 'buy' | 'sell' | 'hold'
  run_id      uuid REFERENCES analysis.fundsignal_runs(run_id),
  PRIMARY KEY (symbol, source, as_of_date)
);
