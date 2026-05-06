ALTER TABLE portfolio.positions
    ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'alpaca-default';

-- Drop old 3-column unique constraint; add new 4-column constraint.
ALTER TABLE portfolio.positions
    DROP CONSTRAINT IF EXISTS positions_user_id_symbol_trading_mode_key;

ALTER TABLE portfolio.positions
    ADD CONSTRAINT positions_user_symbol_mode_account_key
    UNIQUE (user_id, symbol, trading_mode, account_id);

CREATE INDEX IF NOT EXISTS positions_account_id_idx ON portfolio.positions (account_id);
