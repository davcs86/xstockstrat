-- Migration: 060_authelia_sso_keys.up.sql
-- Service: xstockstrat-config, feature authelia-sso (345). Stored keys are namespace-relative (045 CHECK); no notify.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('identity', 'auth.mode', 'string', 'local',
   'Login mode for this deployment: local (password; built-in MCP OAuth), both (SSO and password; Link SSO; built-in MCP OAuth) or oidc (SSO only; MCP accepts issuer tokens only). Any other value reads as local. Read globally; set with scripts/manage-users.py set-auth-mode.',
   'local', 'xstockstrat-identity', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('identity', 'auth.mode', 'string', 'local',
   'Login mode for this deployment: local (password; built-in MCP OAuth), both (SSO and password; Link SSO; built-in MCP OAuth) or oidc (SSO only; MCP accepts issuer tokens only). Any other value reads as local. Read globally; set with scripts/manage-users.py set-auth-mode.',
   'local', 'xstockstrat-identity', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('ui', 'oidc.issuer', 'string', '',
   'OIDC issuer URL for web sign-in and Link SSO. Read by xstockstrat-ui. Valid form (FR-14): https (http only on localhost, 127.0.0.1 or [::1]), a lowercase host, no IP except loopback, no IDN or xn-- label, no default port, no userinfo, query, fragment or %, and no trailing slash. Empty is invalid in auth.mode both or oidc.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.issuer', 'string', '',
   'OIDC issuer URL for web sign-in and Link SSO. Read by xstockstrat-ui. Valid form (FR-14): https (http only on localhost, 127.0.0.1 or [::1]), a lowercase host, no IP except loopback, no IDN or xn-- label, no default port, no userinfo, query, fragment or %, and no trailing slash. Empty is invalid in auth.mode both or oidc.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('ui', 'oidc.client_id', 'string', '',
   'OIDC client ID of the xstockstrat web client registered at ui/oidc.issuer. Empty is invalid in auth.mode both or oidc.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.client_id', 'string', '',
   'OIDC client ID of the xstockstrat web client registered at ui/oidc.issuer. Empty is invalid in auth.mode both or oidc.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('ui', 'oidc.mcp_client_id', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude.ai MCP connectors (full scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.mcp_client_id', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude.ai MCP connectors (full scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('ui', 'oidc.mcp_client_id_readonly', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude.ai MCP connectors (read-only scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.mcp_client_id_readonly', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude.ai MCP connectors (read-only scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('ui', 'oidc.mcp_client_id_claude_code', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude Code MCP clients (full scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.mcp_client_id_claude_code', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude Code MCP clients (full scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('ui', 'oidc.mcp_client_id_claude_code_readonly', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude Code MCP clients (read-only scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.mcp_client_id_claude_code_readonly', 'string', '',
   'Pre-registered issuer client ID shown on /accounts/authorized-apps for Claude Code MCP clients (read-only scope) in auth.mode oidc. Empty hides the line.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL),
  ('agent', 'oidc.issuer', 'string', '',
   'OIDC issuer URL for MCP bearer tokens in auth.mode oidc. Read by xstockstrat-agent. Valid form (FR-14): https (http only on localhost, 127.0.0.1 or [::1]), a lowercase host, no IP except loopback, no IDN or xn-- label, no default port, no userinfo, query, fragment or %, and no trailing slash. Empty is invalid in auth.mode both or oidc.',
   '', 'xstockstrat-agent', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('agent', 'oidc.issuer', 'string', '',
   'OIDC issuer URL for MCP bearer tokens in auth.mode oidc. Read by xstockstrat-agent. Valid form (FR-14): https (http only on localhost, 127.0.0.1 or [::1]), a lowercase host, no IP except loopback, no IDN or xn-- label, no default port, no userinfo, query, fragment or %, and no trailing slash. Empty is invalid in auth.mode both or oidc.',
   '', 'xstockstrat-agent', 'system:config-migration-feature-authelia-sso', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

-- Ciphertext stays NULL: a migration has no master key. GetSecret answers found=false until the key is set.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('ui', 'oidc.client_secret', 'string', '[redacted]', TRUE,
   'OIDC client secret of the xstockstrat web client (encrypted secret; set per environment with SetConfig). Decrypted only by GetSecret for xstockstrat-ui.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'staging', NULL),
  ('ui', 'oidc.client_secret', 'string', '[redacted]', TRUE,
   'OIDC client secret of the xstockstrat web client (encrypted secret; set per environment with SetConfig). Decrypted only by GetSecret for xstockstrat-ui.',
   '', 'xstockstrat-ui', 'system:config-migration-feature-authelia-sso', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
