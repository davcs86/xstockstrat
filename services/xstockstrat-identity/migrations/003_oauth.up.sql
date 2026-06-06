-- Migration: 003_oauth.sql
-- Service: xstockstrat-identity
-- Feature 049 Part B — OAuth 2.1 durable client/code store (the MCP agent is the
-- stateless AS/RS facade; identity owns this state). Refresh tokens reuse
-- identity.refresh_tokens (no new table).

CREATE TABLE IF NOT EXISTS identity.oauth_clients (
    client_id       TEXT            PRIMARY KEY,
    redirect_uris   TEXT[]          NOT NULL DEFAULT '{}',
    client_name     TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity.oauth_auth_codes (
    code            TEXT            PRIMARY KEY,  -- SHA-256 hash of the issued code
    client_id       TEXT            NOT NULL REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE,
    user_id         UUID            NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
    redirect_uri    TEXT            NOT NULL,
    code_challenge  TEXT            NOT NULL,
    resource        TEXT,
    expires_at      TIMESTAMPTZ     NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON identity.oauth_auth_codes (client_id);
