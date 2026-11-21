-- feature 352: per-symbol backfill outcomes keyed by chunk; NULL = no per-symbol results.
ALTER TABLE ingest.backfill_jobs ADD COLUMN IF NOT EXISTS symbol_results jsonb;
