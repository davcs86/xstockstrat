-- Migration: 002_push_subscriptions.up.sql
-- Service: xstockstrat-notify
-- Feature 165 (pwa-notifications): stores Web Push subscriptions, one row per installed device+origin.
--
-- `endpoint` is UNIQUE — it is both the ON CONFLICT upsert target (RegisterPushSubscription) and the
-- delete key (UnregisterPushSubscription); the browser proves possession of an endpoint via
-- getSubscription(), so the endpoint is the capability. Low-volume relational table — no hypertable.

CREATE TABLE IF NOT EXISTS notify.push_subscriptions (
    subscription_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT         NOT NULL,
    endpoint         TEXT         NOT NULL UNIQUE,
    p256dh           TEXT         NOT NULL,
    auth             TEXT         NOT NULL,
    user_agent       TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON notify.push_subscriptions (user_id);
