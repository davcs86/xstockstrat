ALTER TABLE trading.orders
    DROP COLUMN IF EXISTS account_id,
    DROP COLUMN IF EXISTS broker_type;
