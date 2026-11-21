-- feature 352: reverse 018_backfill_symbol_results.up.sql
ALTER TABLE ingest.backfill_jobs DROP COLUMN IF EXISTS symbol_results;
