-- Migration: 006_agent_oauth_config.down.sql
-- Removes the agent OAuth config keys

DELETE FROM config.config_values
WHERE namespace = 'agent'
  AND key IN ('oauth.registration_enabled', 'oauth.allowed_redirect_uris');
