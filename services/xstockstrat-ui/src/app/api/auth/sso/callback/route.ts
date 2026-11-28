import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';
import { generateTraceId, REMEMBER_ME_MAX_AGE_SECONDS, setSessionCookies } from '@/lib/auth';
import { recordAuthEvent, withBffMetrics } from '@/lib/bffMetrics';
import { identityClient } from '@/lib/connectClients';
import { AUTH_CONFIG_TIMEOUT_MS, OIDC_CLOCK_SKEW_S } from '@/lib/deadlines';
import { HEADER_TRACE_ID } from '@/lib/headers';
import { exchangeCode, getOidcConfiguration, type SsoClaims } from '@/lib/oidcClient';
import { loadAuthMode, loadOidcClientSecret, loadOidcConfig } from '@/lib/oidcConfig';
import { safeRedirect } from '@/lib/safeRedirect';
import { appOrigin } from '@/lib/sameOrigin';
import { serverLog } from '@/lib/serverLog';
import {
  resolveRefusalCode,
  sessionRefusalCode,
  ssoErrorRedirect,
  type LinkErrorCode,
  type SsoErrorCode,
} from '@/lib/ssoErrors';
import {
  clearAllTxnCookies,
  openSsoTxn,
  sealSsoLink,
  SSO_LINK_COOKIE,
  ssoLinkCookieOpts,
  txnCookieName,
  type SsoTxn,
} from '@/lib/ssoTxn';

const LINK_LABEL_DEFAULT = 'your single sign-on account';

// Never log the code, tokens, the token response, email or sub (D-75).
async function getHandler(req: NextRequest) {
  const traceId = req.headers.get(HEADER_TRACE_ID) ?? generateTraceId();
  const origin = appOrigin();
  const loginFail = (code: SsoErrorCode, opts: { fault?: boolean; clearTxnCookie?: string } = {}) =>
    ssoErrorRedirect({ dest: 'login', code }, origin, opts);
  const linkFail = (code: LinkErrorCode, clearTxnCookie?: string) =>
    ssoErrorRedirect({ dest: 'link', code }, origin, { clearTxnCookie });

  const mode = await loadAuthMode();
  if (mode === 'local') return new NextResponse(null, { status: 404 });
  if (mode === 'error') return loginFail('failed', { fault: true });
  const cfg = await loadOidcConfig();
  if (cfg === 'error') return loginFail('failed', { fault: true });
  if (!cfg.valid || origin === null) return loginFail('not_configured');

  const params = req.nextUrl.searchParams;
  const state = params.get('state');
  const cookieName = state ? txnCookieName(state) : undefined;
  const sealed = cookieName ? req.cookies.get(cookieName)?.value : undefined;
  const txn = sealed ? await openSsoTxn(sealed) : null;

  const idpError = params.get('error');
  if (idpError !== null) {
    const code = idpError === 'access_denied' ? 'no_access' : 'failed';
    return txn?.purpose === 'link'
      ? linkFail(code, cookieName)
      : loginFail(code, { clearTxnCookie: cookieName });
  }
  if (!txn) return loginFail('failed');

  const fail = (code: SsoErrorCode & LinkErrorCode, fault = false) =>
    txn.purpose === 'link' ? linkFail(code) : loginFail(code, { fault });

  const secret = await loadOidcClientSecret();
  if (secret === 'error') return fail('failed', true);
  if (!secret.found) return fail('not_configured');

  let claims: SsoClaims;
  try {
    const oidc = await getOidcConfiguration(cfg.issuer, cfg.clientId, secret.value);
    claims = await exchangeCode(
      oidc,
      new URL(`/api/auth/sso/callback${req.nextUrl.search}`, origin),
      {
        pkceCodeVerifier: txn.code_verifier,
        expectedState: txn.state,
        expectedNonce: txn.nonce,
      },
    );
  } catch (err) {
    serverLog.warn('sso_callback_failed', {
      error_class: err instanceof Error ? err.constructor.name : typeof err,
    });
    return fail('failed');
  }

  if (txn.purpose === 'link') return completeLink(req, txn, claims, mode, origin);

  const opts = { timeoutMs: AUTH_CONFIG_TIMEOUT_MS, headers: { [HEADER_TRACE_ID]: traceId } };
  let userId: string;
  try {
    ({ userId } = await identityClient.resolveExternalIdentity(
      { issuer: claims.iss, subject: claims.sub },
      opts,
    ));
  } catch (err) {
    const ce = ConnectError.from(err);
    return loginFail(
      ce.code === Code.FailedPrecondition ? resolveRefusalCode(ce.rawMessage) : 'failed',
    );
  }
  let session: { accessToken: string; refreshToken: string };
  try {
    session = await identityClient.issueSessionForUser({ userId }, opts);
  } catch (err) {
    const ce = ConnectError.from(err);
    return loginFail(
      ce.code === Code.FailedPrecondition ? sessionRefusalCode(ce.rawMessage) : 'failed',
    );
  }
  const res = new NextResponse(null, {
    status: 303,
    headers: { location: new URL(safeRedirect(txn.redirect), origin).href },
  });
  setSessionCookies(
    res,
    session.accessToken,
    session.refreshToken,
    txn.remember ? { maxAge: REMEMBER_ME_MAX_AGE_SECONDS } : undefined,
  );
  clearAllTxnCookies(req, res);
  recordAuthEvent('sso_login_ok');
  return res;
}

async function completeLink(
  req: NextRequest,
  txn: Extract<SsoTxn, { purpose: 'link' }>,
  claims: SsoClaims,
  mode: 'both' | 'oidc',
  origin: string,
): Promise<NextResponse> {
  const linkFailed = () => ssoErrorRedirect({ dest: 'link', code: 'failed' }, origin);
  if (mode !== 'both') return linkFailed();
  const at = claims.auth_time;
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    serverLog.warn('sso_link_refused', { reason: 'auth_time_missing' });
    return linkFailed();
  }
  if (at < txn.created_at - OIDC_CLOCK_SKEW_S) {
    serverLog.warn('sso_link_refused', { reason: 'auth_time_stale' });
    return linkFailed();
  }
  const res = new NextResponse(null, {
    status: 303,
    headers: { location: new URL('/accounts/sso', origin).href },
  });
  res.cookies.set(
    SSO_LINK_COOKIE,
    await sealSsoLink({
      link_id: randomUUID(),
      iss: claims.iss,
      sub: claims.sub,
      label: claims.email ?? claims.preferred_username ?? LINK_LABEL_DEFAULT,
      user_id: txn.user_id,
      session_hash: txn.session_hash,
      exp: txn.exp,
    }),
    ssoLinkCookieOpts(txn.exp),
  );
  clearAllTxnCookies(req, res);
  return res;
}

export const GET = withBffMetrics('auth', '/api/auth/sso/callback', getHandler);
