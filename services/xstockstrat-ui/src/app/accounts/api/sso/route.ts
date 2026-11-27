import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { withBffMetrics } from '@/lib/bffMetrics';
import { identityClient } from '@/lib/connectClients';
import { AUTH_CONFIG_TIMEOUT_MS } from '@/lib/deadlines';
import { loadAuthMode, loadOidcConfig } from '@/lib/oidcConfig';
import { isValidIssuer } from '@/lib/oidcIssuer';
import { restBackendHeaders } from '@/lib/restBackendHeaders';
import { openSsoLink, SSO_LINK_COOKIE } from '@/lib/ssoTxn';

// GET /accounts/api/sso — the session user's link status; the body never carries iss or sub.
async function getHandler(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [mode, cfg] = await Promise.all([loadAuthMode(), loadOidcConfig()]);
  let issuers: string[];
  try {
    ({ issuers } = await identityClient.getExternalIdentityLinks(
      { userId: claims.user_id },
      {
        headers: restBackendHeaders(req, claims.user_id, claims.roles),
        timeoutMs: AUTH_CONFIG_TIMEOUT_MS,
      },
    ));
  } catch {
    return NextResponse.json({ error: 'failed' }, { status: 503 });
  }
  // D-134: without a valid configured issuer, any link counts.
  const linked =
    cfg !== 'error' && isValidIssuer(cfg.issuer)
      ? issuers.includes(cfg.issuer)
      : issuers.length > 0;
  if (mode === 'error') {
    return NextResponse.json({ mode, linked, canLink: false, pending: null });
  }
  const canLink = mode === 'both';
  const sealed = canLink ? req.cookies.get(SSO_LINK_COOKIE)?.value : undefined;
  const link = sealed ? await openSsoLink(sealed) : null;
  const pending =
    link && link.user_id === claims.user_id
      ? { linkId: link.link_id, label: link.label, accountEmail: claims.email }
      : null;
  return NextResponse.json({ mode, linked, canLink, pending });
}

export const GET = withBffMetrics('accounts', '/accounts/api/sso', getHandler);
