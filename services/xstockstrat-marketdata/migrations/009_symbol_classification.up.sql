-- feature 217 (numbered 009: 008 merged first; 007 is intentionally unused): Type-2 SCD sector classification (FMP-sourced, GICS-flavored).
-- Plain (non-hypertable) table — ~1–2 rows per symbol. valid_from inclusive, valid_to exclusive;
-- NULL valid_to = the open (current) row. Epoch-seed rows use valid_from = 1900-01-01T00:00:00Z.
CREATE TABLE IF NOT EXISTS marketdata.symbol_classification (
    symbol       TEXT NOT NULL,
    sector       TEXT NOT NULL,
    taxonomy     TEXT NOT NULL DEFAULT 'GICS',
    source       TEXT NOT NULL,
    valid_from   TIMESTAMPTZ NOT NULL,
    valid_to     TIMESTAMPTZ,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, valid_from)
);

-- Exactly one open row per symbol: the epoch-seed INSERT's ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_symbol_classification_open
    ON marketdata.symbol_classification (symbol) WHERE valid_to IS NULL;
