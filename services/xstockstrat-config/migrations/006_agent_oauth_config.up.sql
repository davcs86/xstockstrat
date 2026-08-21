-- Migration: 006_agent_oauth_config.up.sql
-- Service: xstockstrat-config
-- Seeds the feature 049 Part B agent OAuth keys documented in root CLAUDE.md.
-- The agent already reads these via one-shot GetConfig (namespace 'agent') and
-- falls back to the same defaults when absent; seeding makes them visible,
-- editable, and auditable through the config service.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('agent', 'oauth.registration_enabled', 'bool', 'true',
   'Allow RFC 7591 Dynamic Client Registration at /oauth/register. Disabled => 403.',
   'true', 'xstockstrat-agent', 'dev', 'all'),
  ('agent', 'oauth.registration_enabled', 'bool', 'true',
   'Allow RFC 7591 Dynamic Client Registration at /oauth/register. Disabled => 403.',
   'true', 'xstockstrat-agent', 'production', 'all'),
  ('agent', 'oauth.allowed_redirect_uris', 'string', '',
   'Comma-separated exact redirect URIs allowed at client registration; empty = require https:// at registration only (no allow-any).',
   '', 'xstockstrat-agent', 'dev', 'all'),
  ('agent', 'oauth.allowed_redirect_uris', 'string', '',
   'Comma-separated exact redirect URIs allowed at client registration; empty = require https:// at registration only (no allow-any).',
   '', 'xstockstrat-agent', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
