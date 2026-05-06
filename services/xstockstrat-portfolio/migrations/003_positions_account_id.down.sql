ALTER TABLE portfolio.positions
    DROP CONSTRAINT IF EXISTS positions_user_symbol_mode_account_key;

ALTER TABLE portfolio.positions
    DROP COLUMN IF EXISTS account_id;

ALTER TABLE portfolio.positions
    ADD CONSTRAINT positions_user_id_symbol_trading_mode_key
    UNIQUE (user_id, symbol, trading_mode);
