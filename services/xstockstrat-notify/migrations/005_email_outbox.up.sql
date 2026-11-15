-- Migration: 005_email_outbox.up.sql
-- Service: xstockstrat-notify, feature notify-commsgun-channel.
-- `alert_id` is UNIQUE: it is the ON CONFLICT target that keeps one row, and so at most one email, per alert.

CREATE TABLE IF NOT EXISTS notify.email_outbox (
    outbox_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id          UUID         NOT NULL UNIQUE,
    recipient         TEXT,
    subject           TEXT,
    text_body         TEXT,
    state             TEXT         NOT NULL DEFAULT 'pending'
                                   CHECK (state IN ('pending', 'delivered', 'undelivered', 'rerouted')),
    fallback          TEXT         CHECK (fallback IN ('none', 'sendgrid')),
    reroute_reason    TEXT         CHECK (reroute_reason IN ('deliberate', 'lost_config')),
    attempts          INT          NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_error        TEXT,
    escalated_at      TIMESTAMPTZ,
    fallback_sent_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Message content exists only while the row is pending.
    CONSTRAINT email_outbox_content_iff_pending CHECK (
        (state = 'pending' AND recipient IS NOT NULL AND subject IS NOT NULL AND text_body IS NOT NULL)
        OR (state <> 'pending' AND recipient IS NULL AND subject IS NULL AND text_body IS NULL)
    ),
    CONSTRAINT email_outbox_fallback_iff_not_delivered CHECK (
        (state IN ('undelivered', 'rerouted')) = (fallback IS NOT NULL)
    ),
    CONSTRAINT email_outbox_reason_iff_rerouted CHECK (
        (state = 'rerouted') = (reroute_reason IS NOT NULL)
    ),
    CONSTRAINT email_outbox_escalated_only_terminal CHECK (
        escalated_at IS NULL OR state IN ('undelivered', 'rerouted')
    ),
    CONSTRAINT email_outbox_fallback_sent_only_sendgrid CHECK (
        fallback_sent_at IS NULL OR fallback = 'sendgrid'
    )
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
    ON notify.email_outbox (next_attempt_at) WHERE state = 'pending';

-- Rows that require an alert and have none.
CREATE INDEX IF NOT EXISTS idx_email_outbox_needs_alert
    ON notify.email_outbox (outbox_id)
    WHERE escalated_at IS NULL AND (state = 'undelivered' OR (state = 'rerouted' AND (reroute_reason = 'lost_config' OR fallback_sent_at IS NULL)));
