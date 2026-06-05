-- Track the health of each broker account's stored API credentials so the UI can
-- surface accounts whose secrets stopped working.
-- credential_status values match the trading.v1.CredentialStatus proto enum:
--   0 = UNSPECIFIED (never validated), 1 = OK, 2 = INVALID, 3 = UNKNOWN.
ALTER TABLE trading.broker_accounts
    ADD COLUMN IF NOT EXISTS credential_status     SMALLINT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credential_checked_at TIMESTAMPTZ;
