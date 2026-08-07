-- Migration: 005_broker_accounts_halted.sql
-- Service: xstockstrat-trading
-- Feature 030 (stop-loss-bracket-orders): persisted per-account automated halt gate
-- (mirrors credential_status's persisted-column + boot-hydrate precedent, migration 004)
-- plus the persisted bracket state machine table. Filename pre-assigned by
-- docs/roadmap/features/merge-order.md; 006/007 are reserved for features 101/102.
ALTER TABLE trading.broker_accounts
    ADD COLUMN IF NOT EXISTS halted     BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS halted_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS halt_reason TEXT;

CREATE TABLE IF NOT EXISTS trading.order_brackets (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                   UUID        NOT NULL,
    account_id                 TEXT        NOT NULL,
    broker_type                SMALLINT    NOT NULL,
    status                     SMALLINT    NOT NULL DEFAULT 0, -- 0=NONE 1=SUBMITTING 2=PENDING_VERIFY 3=ACTIVE 4=CANCELING 5=CANCELED 6=FAILED
    bracket_stop_price         NUMERIC(18,8) NOT NULL,
    bracket_take_profit_price  NUMERIC(18,8),
    stop_leg_order_id          TEXT,
    take_profit_leg_order_id   TEXT,
    protection_deadline        TIMESTAMPTZ NOT NULL,
    fail_reason                TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_brackets_order_id_idx ON trading.order_brackets (order_id);
-- Watchdog scan target: only non-ACTIVE, non-terminal rows can be "unprotected".
CREATE INDEX IF NOT EXISTS order_brackets_protection_watch_idx
    ON trading.order_brackets (protection_deadline)
    WHERE status IN (0, 1, 2, 4);
