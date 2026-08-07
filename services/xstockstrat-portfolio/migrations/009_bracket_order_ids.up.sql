-- Migration: 009_bracket_order_ids.sql
-- Service: xstockstrat-portfolio
-- Feature 030: display-only bracket leg order IDs, populated asynchronously from
-- trading's order.bracket_updated ledger event.
ALTER TABLE portfolio.positions
    ADD COLUMN IF NOT EXISTS stop_order_id        TEXT,
    ADD COLUMN IF NOT EXISTS take_profit_order_id  TEXT;
