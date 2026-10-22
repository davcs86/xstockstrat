DROP TABLE IF EXISTS trading.offline_snapshot_headers;
ALTER TABLE trading.orders DROP COLUMN IF EXISTS fees;
