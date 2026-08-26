-- 008_offline_accounts.up.sql
-- Service: xstockstrat-trading
-- Feature 157 (offline-account-portfolios): support manually-tracked OFFLINE accounts.
-- Offline accounts have no broker credentials, so credentials_enc must be nullable.
-- Orders gain a filled_at column carrying the confirmed/observed fill time (broker fills
-- use the broker timestamp; offline confirmations the operator-supplied time). NULL for a
-- NEW/unconfirmed order and every historical order.

ALTER TABLE trading.broker_accounts ALTER COLUMN credentials_enc DROP NOT NULL;

ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ;
