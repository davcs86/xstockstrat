-- 008_offline_accounts.down.sql
-- Reverses 008_offline_accounts.up.sql.
-- NOTE: restoring NOT NULL on credentials_enc will fail if any OFFLINE account row exists
-- (offline accounts store NULL credentials). This is the accepted forward-only convention (F-01):
-- a rollback past this migration assumes no offline account has been created.

ALTER TABLE trading.orders DROP COLUMN IF EXISTS filled_at;

ALTER TABLE trading.broker_accounts ALTER COLUMN credentials_enc SET NOT NULL;
