-- 009_signal_dedup_keys.down.sql
-- Reverse 009: drop the dedup claim table (the index is dropped automatically with it).
DROP TABLE IF EXISTS ingest.signal_dedup_keys;
