import type { ConfigValue } from '@xstockstrat/proto/config/v1/config_pb';
import { configClient } from '@/lib/connectClients';
import { AUTH_CONFIG_TIMEOUT_MS } from './deadlines';
import { nativeConfigEnvironment } from './deploymentEnv';
import { HEADER_INTERNAL_CALLER } from './headers';
import { isValidIssuer } from './oidcIssuer';
import { appOrigin } from './sameOrigin';
import { logOnce } from './serverLog';

export const AUTH_MODES = ['local', 'both', 'oidc'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export type OidcConfig = {
  issuer: string;
  clientId: string;
  mcpClientIds: {
    claude: string;
    claudeReadonly: string;
    claudeCode: string;
    claudeCodeReadonly: string;
  };
  valid: boolean;
};

// Same rules as identity's parseAuthMode (src/authMode.ts): exact match only, anything else → local.
export function parseAuthMode(raw: string | undefined): { mode: AuthMode; invalid: boolean } {
  if (raw === undefined) return { mode: 'local', invalid: false };
  const mode = AUTH_MODES.find((m) => m === raw);
  return mode ? { mode, invalid: false } : { mode: 'local', invalid: true };
}

// Oneof presence, never `value || default`: an absent or non-string value reads as undefined.
function stringOf(v: ConfigValue | undefined): string | undefined {
  return v?.value.case === 'stringVal' ? v.value.value : undefined;
}

// GetConfig carries no headers; only GetSecret sends the internal-caller header (D-130d).
function getConfig(namespace: string) {
  return configClient.getConfig(
    { namespace, environment: nativeConfigEnvironment(), userId: '' },
    { timeoutMs: AUTH_CONFIG_TIMEOUT_MS },
  );
}

export async function loadAuthMode(): Promise<AuthMode | 'error'> {
  try {
    const identity = await getConfig('identity');
    const value = stringOf(identity.values['auth.mode']);
    const { mode, invalid } = parseAuthMode(value);
    if (invalid && value !== undefined) logOnce('warn', 'auth_mode_invalid', value);
    return mode;
  } catch {
    return 'error';
  }
}

export async function loadOidcConfig(): Promise<OidcConfig | 'error'> {
  try {
    const ui = await getConfig('ui');
    const issuer = stringOf(ui.values['oidc.issuer']) ?? '';
    const clientId = stringOf(ui.values['oidc.client_id']) ?? '';
    const mcpClientIds = {
      claude: stringOf(ui.values['oidc.mcp_client_id']) ?? '',
      claudeReadonly: stringOf(ui.values['oidc.mcp_client_id_readonly']) ?? '',
      claudeCode: stringOf(ui.values['oidc.mcp_client_id_claude_code']) ?? '',
      claudeCodeReadonly: stringOf(ui.values['oidc.mcp_client_id_claude_code_readonly']) ?? '',
    };
    const issuerOk = isValidIssuer(issuer);
    if (!issuerOk) {
      logOnce('error', 'sso_issuer_invalid', `ui_issuer\u0000${issuer}`, { reason: 'ui_issuer' });
    }
    const valid = issuerOk && clientId !== '' && appOrigin() !== null;
    return { issuer, clientId, mcpClientIds, valid };
  } catch {
    return 'error';
  }
}

// Never log the returned value.
export async function loadOidcClientSecret(): Promise<
  { found: true; value: string } | { found: false } | 'error'
> {
  try {
    const res = await configClient.getSecret(
      {
        namespace: 'ui',
        key: 'oidc.client_secret',
        environment: nativeConfigEnvironment(),
        userId: '',
      },
      { timeoutMs: AUTH_CONFIG_TIMEOUT_MS, headers: { [HEADER_INTERNAL_CALLER]: 'ui' } },
    );
    return res.found && res.value !== '' ? { found: true, value: res.value } : { found: false };
  } catch {
    return 'error';
  }
}

export async function loadAgentIssuer(): Promise<{ issuer: string; valid: boolean } | 'error'> {
  try {
    const agent = await getConfig('agent');
    const issuer = stringOf(agent.values['oidc.issuer']) ?? '';
    const valid = isValidIssuer(issuer);
    if (!valid) {
      logOnce('error', 'sso_issuer_invalid', `agent_issuer\u0000${issuer}`, {
        reason: 'agent_issuer',
      });
    }
    return { issuer, valid };
  } catch {
    return 'error';
  }
}
