ALTER TABLE trading.broker_accounts
    DROP COLUMN IF EXISTS credential_status,
    DROP COLUMN IF EXISTS credential_checked_at;
