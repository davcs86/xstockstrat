-- Migration: 006_positions_day_pnl
-- Service: xstockstrat-portfolio
--
-- Store the broker's per-position intraday (today's) P&L alongside each synced position
-- so the positions table can show "Today's P/L" distinct from total unrealized P&L.
-- Populated from account.positions.synced, which now carries the broker's intraday
-- valuation (Alpaca unrealized_intraday_pl / unrealized_intraday_plpc). Default 0 =
-- not reported (e.g. order-fill-only positions, or a broker that omits intraday figures);
-- the UI renders 0 as a flat day rather than fabricating a value.

ALTER TABLE portfolio.positions
    ADD COLUMN IF NOT EXISTS day_pnl     NUMERIC(18,8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS day_pnl_pct NUMERIC(18,8) NOT NULL DEFAULT 0;
