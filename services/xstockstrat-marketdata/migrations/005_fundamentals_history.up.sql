-- feature 198: point-in-time historical fundamentals store.
-- Plain table (NOT a hypertable): ~200k slow-growing rows, reads filter period_end (not a time
-- axis), and a hypertable would re-import the feature-153 chunk-lock-OOM surface for no planner
-- gain (design.md §1 / Rejected Alternatives). Mirrors the plain-table snapshot store (002).
-- Idempotency (@AC-1) is the triple PK + ON CONFLICT DO NOTHING at the repo write edge (keep the
-- original as-reported filing); filed_date is a column, deliberately NOT in the key.
CREATE TABLE IF NOT EXISTS marketdata.fundamentals_history (
    symbol          text NOT NULL,
    fiscal_period   text NOT NULL,          -- e.g. 'Q1-2020', 'FY2019'
    period_type     text NOT NULL,          -- 'quarterly' | 'annual'
    period_end      date NOT NULL,
    filed_date      date NOT NULL,          -- SEC filing date — the point-in-time key
    accepted_date   timestamptz,            -- SEC acceptance timestamp (often post-close)
    source          text NOT NULL,          -- 'edgar' | 'edgar+fmp'
    currency        text,
    market_cap      double precision,
    pe_ratio        double precision,
    pb_ratio        double precision,
    dividend_yield  double precision,
    eps             double precision,
    beta            double precision,
    roe             double precision,
    debt_to_equity  double precision,
    price           double precision,
    year_high       double precision,
    year_low        double precision,
    extra_metrics   jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (symbol, fiscal_period, period_type)
);

-- The as-of read filters filed_date (< as_of) and period_end (∈ range) per symbol.
CREATE INDEX IF NOT EXISTS idx_fundamentals_history_symbol_period
    ON marketdata.fundamentals_history (symbol, period_end, filed_date);
