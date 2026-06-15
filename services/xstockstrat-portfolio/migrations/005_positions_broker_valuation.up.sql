-- Migration: 005_positions_broker_valuation
-- Service: xstockstrat-portfolio
--
-- Store the broker's mark-to-market valuation alongside each synced position so the
-- portfolio card can show figures that reconcile with the broker's authoritative equity
-- (Σ market_value = equity − cash) instead of recomputing from marketdata mid-quotes,
-- which use a different price basis and never tie out. Populated from
-- account.positions.synced (Alpaca/IBKR positions endpoints). Default 0 = not reported;
-- the service then falls back to marketdata enrichment for that position.

ALTER TABLE portfolio.positions
    ADD COLUMN IF NOT EXISTS current_price      NUMERIC(18,8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_value       NUMERIC(18,8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unrealized_pnl     NUMERIC(18,8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unrealized_pnl_pct NUMERIC(18,8) NOT NULL DEFAULT 0;
