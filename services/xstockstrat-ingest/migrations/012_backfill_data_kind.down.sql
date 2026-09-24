-- feature 198: reverse 012_backfill_data_kind.up.sql
ALTER TABLE ingest.backfill_chunks DROP COLUMN IF EXISTS data_kind;
ALTER TABLE ingest.backfill_jobs   DROP COLUMN IF EXISTS data_kind;
