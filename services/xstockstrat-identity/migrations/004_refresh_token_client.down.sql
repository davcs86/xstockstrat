-- Migration: 004_refresh_token_client.down.sql
-- Service: xstockstrat-identity
-- Reverse 004 in dependency order: drop the index, then the columns.

DROP INDEX IF EXISTS identity.idx_refresh_user_client;

ALTER TABLE identity.refresh_tokens DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE identity.refresh_tokens DROP COLUMN IF EXISTS client_id;
