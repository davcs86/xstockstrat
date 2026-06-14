-- Migration: 002_idempotency_keys.sql
-- Service: xstockstrat-ledger
-- Dedup map for caller-supplied AppendEvent idempotency keys.
--
-- This is a regular table (NOT a hypertable) on purpose: it needs a real PRIMARY KEY
-- on idempotency_key, which the ledger.events hypertable cannot provide — a unique index
-- on a hypertable must include the partitioning column (recorded_at), which would defeat
-- dedup. Keeping the key map in its own small table sidesteps that limitation.
CREATE TABLE IF NOT EXISTS ledger.idempotency_keys (
    idempotency_key TEXT        PRIMARY KEY,
    event_id        UUID        NOT NULL,  -- the event stored for this key
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports age-based cleanup of the dedup map (keys can be pruned once events
-- older than the dedup window can no longer be retried).
CREATE INDEX IF NOT EXISTS idx_idempotency_recorded_at
    ON ledger.idempotency_keys (recorded_at);
