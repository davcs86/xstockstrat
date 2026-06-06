-- Migration: 003_oauth.down.sql
-- Service: xstockstrat-identity
-- Drop the child (FK) table first, then the parent.

DROP TABLE IF EXISTS identity.oauth_auth_codes;
DROP TABLE IF EXISTS identity.oauth_clients;
