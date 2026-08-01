-- 008_signal_source_health.down.sql
-- Reverse 008: drop the source-health columns.
ALTER TABLE ingest.signal_sources
    DROP COLUMN IF EXISTS health,
    DROP COLUMN IF EXISTS last_seen_at,
    DROP COLUMN IF EXISTS last_error,
    DROP COLUMN IF EXISTS signals_fed;
