ALTER TABLE portfolio.positions
    DROP COLUMN IF EXISTS stop_order_id,
    DROP COLUMN IF EXISTS take_profit_order_id;
