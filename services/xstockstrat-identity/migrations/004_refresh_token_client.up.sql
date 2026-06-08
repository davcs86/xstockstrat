-- Migration: 004_refresh_token_client.up.sql
-- Service: xstockstrat-identity
-- Feature 051 — link refresh tokens to the OAuth client that minted them so
-- "My Authorized Apps" can list/revoke per-user OAuth grants. A NULL client_id
-- is a first-party user session (today's authenticateUser/refreshToken behavior,
-- unchanged); a non-NULL client_id is an OAuth-client grant.

ALTER TABLE identity.refresh_tokens
    ADD COLUMN IF NOT EXISTS client_id TEXT
        REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE;

ALTER TABLE identity.refresh_tokens
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Per-(user, client) listing/revoke lookups (FR-2 / FR-4); only OAuth grants matter.
CREATE INDEX IF NOT EXISTS idx_refresh_user_client
    ON identity.refresh_tokens (user_id, client_id)
    WHERE client_id IS NOT NULL;
