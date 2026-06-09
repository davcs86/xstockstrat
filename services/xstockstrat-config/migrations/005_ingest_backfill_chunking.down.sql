-- Migration: 005_ingest_backfill_chunking.down.sql
-- Removes the ingest.backfill chunking keys.

DELETE FROM config.config_values
WHERE namespace = 'ingest'
  AND key IN (
    'backfill.chunk_max_bars',
    'backfill.chunk_window_days',
    'backfill.max_concurrent_chunks'
  );
