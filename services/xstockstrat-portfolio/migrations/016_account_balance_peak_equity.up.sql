ALTER TABLE portfolio.account_balances
    ADD COLUMN peak_equity DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Seed the high-water-mark to current equity (peak = current at introduction;
-- no reference to last_equity or any other column).
UPDATE portfolio.account_balances SET peak_equity = equity;
