-- Migration: 030_opportunity_compute_state_live_only_cursor.down.sql
-- Service: xstockstrat-analysis

ALTER TABLE analysis.opportunity_compute_state DROP COLUMN IF EXISTS live_only_cursor;
