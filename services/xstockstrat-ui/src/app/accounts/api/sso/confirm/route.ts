import { NextRequest, NextResponse } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';
import { getSessionFromRequest } from '@/lib/auth';
import { recordAuthEvent, withBffMetrics } from '@/lib/bffMetrics';
import { identityClient } from '@/lib/connectClients';
import { AUTH_CONFIG_TIMEOUT_MS } from '@/lib/deadlines';
import { loadAuthMode } from '@/lib/oidcConfig';
import { restBackendHeaders } from '@/lib/restBackendHeaders';
import { isSameOrigin } from '@/lib/sameOrigin';
import { linkRefusalCode, type LinkErrorCode } from '@/lib/ssoErrors';
import { clearSsoLink, openSsoLink, SSO_LINK_COOKIE } from '@/lib/ssoTxn';

// A refusal is never 401: apiFetch would retry it after a refresh (authRedirect.ts).
function refuse(code: LinkErrorCode, status: number, clearLink: boolean): NextResponse {
  recordAuthEvent('sso_link_failed', code);
  const res = NextResponse.json({ error: code }, { status });
  if (clearLink) clearSsoLink(res);
  return res;
}

// POST /accounts/api/sso/confirm {linkId, password}. Never log the password.
async function postHandler(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const mode = await loadAuthMode();
  if (mode === 'error') return refuse('failed', 503, false);
  if (mode !== 'both') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!isSameOrigin(req, 'required')) return refuse('failed', 403, false);

  const body = await req.json().catch(() => ({}));
  const sealed = req.cookies.get(SSO_LINK_COOKIE)?.value;
  const link = sealed ? await openSsoLink(sealed) : null;
  if (!link || link.user_id !== claims.user_id || link.link_id !== body?.linkId) {
    return refuse('failed', 400, true);
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (password === '') return refuse('invalid_credentials', 400, false);

  try {
    await identityClient.linkExternalIdentity(
      { userId: claims.user_id, issuer: link.iss, subject: link.sub, password },
      {
        headers: restBackendHeaders(req, claims.user_id, claims.roles),
        timeoutMs: AUTH_CONFIG_TIMEOUT_MS,
      },
    );
  } catch (err) {
    const ce = ConnectError.from(err);
    const code = ce.code === Code.FailedPrecondition ? linkRefusalCode(ce.rawMessage) : null;
    if (code === null) return refuse('failed', 503, false);
    // invalid_credentials keeps the link for a retry; the edge zone bounds guesses (P-5).
    return refuse(code, 400, code !== 'invalid_credentials');
  }
  const res = NextResponse.json({ ok: true });
  clearSsoLink(res);
  return res;
}

export const POST = withBffMetrics('accounts', '/accounts/api/sso/confirm', postHandler);
