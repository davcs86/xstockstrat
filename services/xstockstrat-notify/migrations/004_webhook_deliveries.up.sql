-- Migration: 004_webhook_deliveries.up.sql
-- Service: xstockstrat-notify, feature webhook-fanout-callback.
-- `idempotency_key` is UNIQUE: it is the ON CONFLICT target that makes a repeated FanoutWebhook a no-op.

CREATE TABLE IF NOT EXISTS notify.webhook_deliveries (
    delivery_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key  TEXT         NOT NULL UNIQUE,
    callback_url     TEXT         NOT NULL,
    event_name       TEXT         NOT NULL,
    payload          JSONB        NOT NULL,
    source_service   TEXT         NOT NULL,
    state            TEXT         NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'dead')),
    attempts         INT          NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_error       TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
    ON notify.webhook_deliveries (next_attempt_at) WHERE state = 'pending';
