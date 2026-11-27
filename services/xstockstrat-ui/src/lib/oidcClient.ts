import { createHash } from 'node:crypto';
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  ClientSecretBasic,
  type Configuration,
  discovery,
  enableNonRepudiationChecks,
} from 'openid-client';
import { OIDC_DISCOVERY_FRESH_S, OIDC_ID_TOKEN_ALG, OIDC_TIMEOUT_S } from './deadlines';

// Must match the web client's registered scopes at the issuer (spec-level choice 1), or the issuer
// refuses the request with invalid_scope.
export const OIDC_SCOPE = 'openid email profile';

type Slot = { key: string; at: number; promise: Promise<Configuration> };
let slot: Slot | null = null;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// The library compares normalized hrefs; the configured issuer must match byte for byte (D-87).
function assertDiscoveredMetadata(cfg: Configuration, issuer: string): Configuration {
  const meta = cfg.serverMetadata();
  if (meta.issuer !== issuer)
    throw new Error('discovered issuer does not match the configured issuer');
  if (!meta.jwks_uri || new URL(meta.jwks_uri).origin !== new URL(issuer).origin) {
    throw new Error('discovered jwks_uri is not same-origin with the issuer');
  }
  return cfg;
}

export function getOidcConfiguration(
  issuer: string,
  clientId: string,
  secret: string,
): Promise<Configuration> {
  const key = `${issuer}\n${clientId}\n${sha256(secret)}`;
  const now = Date.now();
  if (slot && slot.key === key && now - slot.at <= OIDC_DISCOVERY_FRESH_S * 1000) {
    return slot.promise;
  }
  const promise = discovery(
    new URL(issuer),
    clientId,
    { id_token_signed_response_alg: OIDC_ID_TOKEN_ALG },
    ClientSecretBasic(secret),
    {
      timeout: OIDC_TIMEOUT_S,
      execute: [
        enableNonRepudiationChecks,
        ...(issuer.startsWith('http://') ? [allowInsecureRequests] : []),
      ],
    },
  ).then((cfg) => assertDiscoveredMetadata(cfg, issuer));
  const mine: Slot = { key, at: now, promise };
  slot = mine;
  promise.catch(() => {
    if (slot === mine) slot = null;
  });
  return promise;
}

export function __resetOidcConfigurationCache(): void {
  slot = null;
}

export function buildSsoAuthorizationUrl(
  cfg: Configuration,
  p: { redirectUri: string; state: string; nonce: string; codeChallenge: string; link?: boolean },
): URL {
  return buildAuthorizationUrl(cfg, {
    redirect_uri: p.redirectUri,
    scope: OIDC_SCOPE,
    response_mode: 'query',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    // max_age=0 makes Authelia refuse consent forever (S17); checks.maxAge is never passed (D-139).
    ...(p.link ? { prompt: 'login', max_age: '1' } : {}),
  });
}

export type SsoClaims = {
  iss: string;
  sub: string;
  email?: string;
  preferred_username?: string;
  auth_time?: number;
};

export async function exchangeCode(
  cfg: Configuration,
  currentUrl: URL,
  checks: { pkceCodeVerifier: string; expectedState: string; expectedNonce: string },
): Promise<SsoClaims> {
  const tokens = await authorizationCodeGrant(cfg, currentUrl, {
    ...checks,
    idTokenExpected: true,
  });
  const c = tokens.claims();
  if (!c) throw new Error('no ID token claims');
  return {
    iss: c.iss,
    sub: c.sub,
    ...(typeof c.email === 'string' ? { email: c.email } : {}),
    ...(typeof c.preferred_username === 'string'
      ? { preferred_username: c.preferred_username }
      : {}),
    ...(typeof c.auth_time === 'number' ? { auth_time: c.auth_time } : {}),
  };
}
