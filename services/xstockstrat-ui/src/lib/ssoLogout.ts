import { buildEndSessionUrl, type Configuration } from 'openid-client';
import { AUTH_CONFIG_TIMEOUT_MS, raceDeadline } from './deadlines';
import { getOidcConfiguration } from './oidcClient';
import { serverLog } from './serverLog';

export function portalLogoutUrl(issuer: string, appOrigin: string): string {
  return `${issuer}/logout?rd=${encodeURIComponent(new URL('/auth/login', appOrigin).href)}`;
}

// Only an advertised end_session_endpoint on the issuer's own origin is followed (D-51).
export function endSessionUrl(
  cfg: Configuration,
  appOrigin: string,
  clientId: string,
): string | null {
  const meta = cfg.serverMetadata();
  const endpoint = meta.end_session_endpoint;
  if (!endpoint || new URL(endpoint).origin !== new URL(meta.issuer).origin) return null;
  return buildEndSessionUrl(cfg, {
    post_logout_redirect_uri: new URL('/auth/login', appOrigin).href,
    client_id: clientId,
  }).href;
}

// Never throws: any fault or timeout falls back to the portal URL (D-134).
export async function resolveLogoutRedirect(
  cfg: { issuer: string; clientId: string; appOrigin: string },
  secret: string | null,
): Promise<string> {
  const portal = portalLogoutUrl(cfg.issuer, cfg.appOrigin);
  if (secret === null) return portal;
  try {
    return await raceDeadline(
      getOidcConfiguration(cfg.issuer, cfg.clientId, secret).then(
        (c) => endSessionUrl(c, cfg.appOrigin, cfg.clientId) ?? portal,
      ),
      AUTH_CONFIG_TIMEOUT_MS,
    );
  } catch {
    serverLog.warn('sso_logout_portal_fallback');
    return portal;
  }
}
