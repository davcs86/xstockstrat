-- Migration: 003_events_user_id.down.sql
-- Reverses 003_events_user_id.up.sql (drop the per-user index, then the column).

DROP INDEX IF EXISTS ledger.idx_events_user_sequence;

ALTER TABLE ledger.events DROP COLUMN IF EXISTS user_id;
