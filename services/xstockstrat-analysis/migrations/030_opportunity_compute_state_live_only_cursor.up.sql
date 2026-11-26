-- Migration: 030_opportunity_compute_state_live_only_cursor.up.sql
-- Service: xstockstrat-analysis
-- live_only_cursor is the last-evaluated normalized symbol of the live-only rotation (feature 366);
-- it is written only inside the queue-replace transaction. NULL starts the rotation at the pool head.

ALTER TABLE analysis.opportunity_compute_state ADD COLUMN IF NOT EXISTS live_only_cursor TEXT NULL;
