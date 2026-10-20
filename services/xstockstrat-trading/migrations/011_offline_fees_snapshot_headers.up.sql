-- Feature 230: per-order offline fees + one header per offline snapshot (carry of lifetime realized/fees).
-- offline_snapshot_headers is a plain table, not a hypertable; broker and NEW orders keep fees NULL.
ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS fees NUMERIC(18,8);

UPDATE trading.orders SET fees = 0
WHERE broker_type = 3 AND status IN ('partially_filled', 'filled') AND fees IS NULL;

CREATE TABLE IF NOT EXISTS trading.offline_snapshot_headers (
    account_id         TEXT          NOT NULL,
    client_snapshot_id TEXT          NOT NULL,
    as_of              TIMESTAMPTZ   NOT NULL,
    realized_carried   NUMERIC(18,8) NOT NULL DEFAULT 0,
    fees_carried       NUMERIC(18,8) NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, client_snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_offline_snapshot_headers_account_asof
    ON trading.offline_snapshot_headers (account_id, as_of DESC, created_at DESC);

INSERT INTO trading.offline_snapshot_headers (account_id, client_snapshot_id, as_of, created_at)
SELECT account_id, client_snapshot_id, max(as_of), max(created_at)
FROM trading.offline_position_baselines
GROUP BY 1, 2
ON CONFLICT DO NOTHING;
