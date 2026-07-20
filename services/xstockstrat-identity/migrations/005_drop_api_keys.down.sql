-- Recreate the api_keys table (mirrors 001_identity_tables).
CREATE TABLE IF NOT EXISTS identity.api_keys (
    key_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
    name            TEXT            NOT NULL,
    key_prefix      TEXT            NOT NULL,  -- first 8 chars, for display
    key_hash        TEXT            NOT NULL UNIQUE,  -- SHA-256 of full key
    scopes          TEXT[]          NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON identity.api_keys (user_id);
