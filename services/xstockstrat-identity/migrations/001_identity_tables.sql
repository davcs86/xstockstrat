-- Migration: 001_identity_tables.sql
-- Service: xstockstrat-identity

CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.users (
    user_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT            NOT NULL UNIQUE,
    password_hash   TEXT            NOT NULL,
    roles           TEXT[]          NOT NULL DEFAULT '{"trader"}',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS identity.refresh_tokens (
    token_id        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
    token_hash      TEXT            NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ     NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user    ON identity.api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user     ON identity.refresh_tokens (user_id);
