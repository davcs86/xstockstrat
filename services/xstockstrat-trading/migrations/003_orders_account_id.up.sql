ALTER TABLE trading.orders
    ADD COLUMN IF NOT EXISTS account_id   TEXT     NOT NULL DEFAULT 'alpaca-default',
    ADD COLUMN IF NOT EXISTS broker_type  SMALLINT NOT NULL DEFAULT 1; -- 1=ALPACA

CREATE INDEX IF NOT EXISTS orders_account_id_idx ON trading.orders (account_id);
