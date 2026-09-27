-- feature 211: dividend/corporate-actions store for PIT T12M dividend-yield computation.
-- Plain (non-hypertable) table — per-symbol row count is tiny; the (symbol, ex_date) PK gives
-- idempotent upsert and serves every read (WHERE symbol = $1 AND ex_date <= $2).
CREATE TABLE IF NOT EXISTS marketdata.dividend_actions (
    symbol       TEXT NOT NULL,
    ex_date      DATE NOT NULL,
    pay_date     DATE,
    cash_amount  DOUBLE PRECISION NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'USD',
    source       TEXT NOT NULL DEFAULT 'alpaca',
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, ex_date)
);
