DROP TABLE IF EXISTS trading.order_brackets;
ALTER TABLE trading.broker_accounts
    DROP COLUMN IF EXISTS halted,
    DROP COLUMN IF EXISTS halted_at,
    DROP COLUMN IF EXISTS halt_reason;
