-- Migration: 060_authelia_sso_keys.down.sql
-- Service: xstockstrat-config, feature authelia-sso (345). A row an operator changed, or a set secret, is never deleted.

DELETE FROM config.config_values
WHERE environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-authelia-sso'
  AND ((namespace = 'identity' AND key = 'auth.mode' AND value_data = 'local')
    OR (namespace = 'ui' AND key IN ('oidc.issuer', 'oidc.client_id', 'oidc.mcp_client_id', 'oidc.mcp_client_id_readonly', 'oidc.mcp_client_id_claude_code', 'oidc.mcp_client_id_claude_code_readonly') AND value_data = '')
    OR (namespace = 'agent' AND key = 'oidc.issuer' AND value_data = '')
    OR (namespace = 'ui' AND key = 'oidc.client_secret' AND is_secret AND value_encrypted IS NULL));
