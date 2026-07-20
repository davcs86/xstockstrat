-- Feature: remove the identity API-key feature. The only runtime consumer
-- (ValidateApiKey) has been removed, so the api_keys table is now orphaned.
DROP INDEX IF EXISTS identity.idx_api_keys_user;
DROP TABLE IF EXISTS identity.api_keys;
