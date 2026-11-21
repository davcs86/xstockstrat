-- feature 352: per-symbol delisted state (rows are never deleted, state columns are nulled) and marketdata's copy of portfolio's watchlist symbol union.
CREATE TABLE IF NOT EXISTS marketdata.symbol_profile (
    symbol                TEXT PRIMARY KEY,
    first_unservable_date DATE,
    unservable_reason     SMALLINT,
    delisted_at           TIMESTAMPTZ,
    alert_claimed_at      TIMESTAMPTZ,
    alert_acked_at        TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((first_unservable_date IS NULL) = (unservable_reason IS NULL)),
    CHECK (unservable_reason IS NULL OR unservable_reason > 0),
    CHECK (delisted_at IS NULL OR first_unservable_date IS NOT NULL),
    CHECK (alert_claimed_at IS NULL OR delisted_at IS NOT NULL),
    CHECK (alert_acked_at IS NULL OR alert_claimed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS symbol_profile_flagged_idx
    ON marketdata.symbol_profile (symbol) WHERE delisted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketdata.watched_symbol (
    symbol TEXT PRIMARY KEY
);
