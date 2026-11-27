-- Migration: 019_fill_applied_events.up.sql
-- Service: xstockstrat-portfolio — feature 311: exactly-once fill fold (applied-event keys and the boot-stamped fill floor).

CREATE TABLE IF NOT EXISTS portfolio.consumer_applied_events (
  consumer       TEXT        NOT NULL,
  user_id        TEXT        NOT NULL,
  account_id     TEXT        NOT NULL,
  order_id       TEXT        NOT NULL,
  event_id       TEXT        NOT NULL,
  outcome        TEXT        NOT NULL CHECK (outcome IN ('applied', 'parked')),
  parked_reason  TEXT,
  pending_closed JSONB,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer, user_id, account_id, order_id)
);

-- No row is seeded: the floor is stamped by the service at its first boot.
CREATE TABLE IF NOT EXISTS portfolio.consumer_floors (
  consumer          TEXT        PRIMARY KEY,
  floor_recorded_at TIMESTAMPTZ NOT NULL
);
