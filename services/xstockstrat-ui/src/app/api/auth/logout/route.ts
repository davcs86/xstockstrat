import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, verifyAccessTokenForLogout } from '@/lib/auth';
import { revokeToken } from '@/lib/identity';
import { recordAuthEvent, withBffMetrics } from '@/lib/bffMetrics';
import { loadAuthMode, loadOidcClientSecret, loadOidcConfig } from '@/lib/oidcConfig';
import { appOrigin, isSameOrigin, originHost } from '@/lib/sameOrigin';
import { serverLog } from '@/lib/serverLog';
import { resolveLogoutRedirect } from '@/lib/ssoLogout';
import { clearSsoLink } from '@/lib/ssoTxn';

// Never throws: every loader returns 'error' and the resolver falls back to the portal URL.
async function lookupRedirect(): Promise<string | undefined> {
  const mode = await loadAuthMode();
  if (mode === 'local') return undefined;
  if (mode === 'error') {
    serverLog.warn('sso_logout_mode_unknown');
    return undefined;
  }
  const cfg = await loadOidcConfig();
  const origin = appOrigin();
  if (cfg === 'error' || !cfg.valid || origin === null) return undefined;
  const secret = await loadOidcClientSecret();
  return resolveLogoutRedirect(
    { issuer: cfg.issuer, clientId: cfg.clientId, appOrigin: origin },
    secret === 'error' || !secret.found ? null : secret.value,
  );
}

async function postHandler(req: NextRequest) {
  // Step 0 in every mode (D-77): a present foreign Origin changes nothing, not even a cookie.
  if (!isSameOrigin(req, 'if_present')) {
    recordAuthEvent('logout', 'cross_origin');
    serverLog.warn('logout_origin_mismatch', {
      origin_host: originHost(req.headers.get('origin') ?? ''),
    });
    return NextResponse.json({ error: 'origin mismatch' }, { status: 403 });
  }
  const token = req.cookies.get('access_token')?.value ?? '';
  const reason = await verifyAccessTokenForLogout(token);
  recordAuthEvent('logout', reason);
  // Revoke only a signature-valid token (D-52, D-64).
  const [, redirect] = await Promise.all([
    reason === 'verified' ? revokeToken(token) : undefined,
    lookupRedirect(),
  ]);
  const response = NextResponse.json(
    reason === 'verified' && redirect ? { ok: true, redirect } : { ok: true },
  );
  clearSessionCookies(response);
  clearSsoLink(response);
  return response;
}

export const POST = withBffMetrics('auth', '/api/auth/logout', postHandler);
