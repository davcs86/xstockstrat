-- Migration: 016_order_snapshots_pnl_patterns.down.sql
-- Service: xstockstrat-analysis
-- Reverses 016 — drops the four feature-042 tables in reverse dependency order. Timescale drops the
-- order_snapshots hypertable together with the table.

DROP TABLE IF EXISTS analysis.pnl_pattern_samples;
DROP TABLE IF EXISTS analysis.pnl_positions;
DROP TABLE IF EXISTS analysis.order_snapshots;
DROP TABLE IF EXISTS analysis.ledger_stream_cursor;
