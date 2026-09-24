-- feature 198: add a data_kind axis to backfill jobs/chunks so a fundamentals backfill is a
-- distinct kind, not a bar timeframe (feature 143 restricts the timeframe axis to 1d). Default
-- 'BARS' preserves every existing OHLCV job/chunk (@AC-6).
ALTER TABLE ingest.backfill_jobs   ADD COLUMN IF NOT EXISTS data_kind text NOT NULL DEFAULT 'BARS';
ALTER TABLE ingest.backfill_chunks ADD COLUMN IF NOT EXISTS data_kind text NOT NULL DEFAULT 'BARS';
