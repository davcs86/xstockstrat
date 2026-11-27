-- Migration: 012_bracket_legs.up.sql
-- Service: xstockstrat-trading — feature 311: per-leg bracket fill tracking. DDL only; legs are adopted at runtime.

CREATE TABLE IF NOT EXISTS trading.bracket_legs (
    account_id          TEXT          NOT NULL,
    leg_order_id        TEXT          NOT NULL,
    order_id            UUID          NOT NULL,
    user_id             TEXT          NOT NULL,
    trading_mode        TEXT          NOT NULL,
    symbol              TEXT          NOT NULL,
    side                TEXT          NOT NULL CHECK (side IN ('buy', 'sell')),
    filled_qty          NUMERIC(18,8) NOT NULL DEFAULT 0, -- emit cursor: advanced only after the keyed ledger append succeeds
    observed_filled_qty NUMERIC(18,8) NOT NULL DEFAULT 0, -- written on every observation; read by reconciliation
    status              TEXT          NOT NULL DEFAULT 'OPEN', -- no CHECK: the retired-status set is one Go constant
    not_found_ticks     SMALLINT      NOT NULL DEFAULT 0,
    adopted             BOOLEAN       NOT NULL DEFAULT false, -- only reader: the GetOrder fallback sort
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, leg_order_id)
);
