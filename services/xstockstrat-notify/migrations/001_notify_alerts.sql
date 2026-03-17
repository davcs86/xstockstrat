-- Migration: 001_notify_alerts.sql
-- Service: xstockstrat-notify

CREATE SCHEMA IF NOT EXISTS notify;

CREATE TABLE IF NOT EXISTS notify.alerts (
    alert_id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    severity            INTEGER         NOT NULL DEFAULT 1,
    category            TEXT            NOT NULL,
    title               TEXT            NOT NULL,
    body                TEXT            NOT NULL DEFAULT '',
    source_service      TEXT            NOT NULL,
    target_user_id      TEXT,           -- NULL means broadcast
    context             JSONB           NOT NULL DEFAULT '{}',
    tags                TEXT[]          NOT NULL DEFAULT '{}',
    correlation_id      TEXT,
    acknowledged        BOOLEAN         NOT NULL DEFAULT FALSE,
    acknowledged_by     TEXT,
    acknowledged_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user       ON notify.alerts (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_category   ON notify.alerts (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity   ON notify.alerts (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unacked    ON notify.alerts (acknowledged, created_at DESC) WHERE NOT acknowledged;
