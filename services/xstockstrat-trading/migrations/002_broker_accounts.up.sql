CREATE TABLE IF NOT EXISTS trading.broker_accounts (
    id              TEXT        NOT NULL PRIMARY KEY,
    display_name    TEXT        NOT NULL,
    broker_type     SMALLINT    NOT NULL, -- 1=ALPACA, 2=IBKR (matches BrokerType proto enum)
    is_paper        BOOLEAN     NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    user_id         TEXT        NOT NULL,
    credentials_enc BYTEA       NOT NULL, -- AES-256-GCM encrypted JSON blob
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_accounts_user_id_idx ON trading.broker_accounts (user_id);
CREATE INDEX IF NOT EXISTS broker_accounts_active_idx  ON trading.broker_accounts (is_active) WHERE is_active = TRUE;
