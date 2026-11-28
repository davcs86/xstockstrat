import { NextRequest, NextResponse } from 'next/server';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import {
  getSessionFromRequest,
  rememberMeOptsFromRequest,
  setSessionCookies,
  verifyAccessToken,
  type JwtClaims,
} from '@/lib/auth';
import { withBffMetrics } from '@/lib/bffMetrics';
import { refreshSession } from '@/lib/identity';
import { buildSsoAuthorizationUrl, getOidcConfiguration } from '@/lib/oidcClient';
import { loadAuthMode, loadOidcClientSecret, loadOidcConfig } from '@/lib/oidcConfig';
import { appOrigin, isSameOrigin } from '@/lib/sameOrigin';
import { serverLog } from '@/lib/serverLog';
import {
  LINK_MIN_ACCESS_LIFETIME_S,
  sealSsoTxn,
  sessionHash,
  TXN_COOKIE_OPTS,
  txnCookieName,
} from '@/lib/ssoTxn';

const error = (code: string, status: number) => NextResponse.json({ error: code }, { status });

const ttlTooShort = (c: JwtClaims) => c.expires_at - c.issued_at < LINK_MIN_ACCESS_LIFETIME_S;

// The session the link binds to: rotated first when it would otherwise rotate mid-link (370).
async function bindableSession(
  req: NextRequest,
  claims: JwtClaims,
): Promise<NextResponse | { refreshToken: string; rotated?: { accessToken: string } }> {
  const refreshToken = req.cookies.get('refresh_token')?.value;
  if (!refreshToken) return error('unauthorized', 401);
  const refuseTtl = () => {
    serverLog.warn('sso_link_refused', { reason: 'access_ttl_too_short' });
    return error('failed', 503);
  };
  if (ttlTooShort(claims)) return refuseTtl();
  if (claims.expires_at - Math.floor(Date.now() / 1000) >= LINK_MIN_ACCESS_LIFETIME_S) {
    return { refreshToken };
  }
  const result = await refreshSession(refreshToken);
  if (!result) return error('unauthorized', 401);
  const fresh = await verifyAccessToken(result.accessToken);
  if (!fresh) return error('unauthorized', 401);
  if (ttlTooShort(fresh)) return refuseTtl();
  return { refreshToken: result.refreshToken, rotated: { accessToken: result.accessToken } };
}

// POST /accounts/api/sso/link — no body; the txn's user_id is always the session's (D-107).
async function postHandler(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return error('unauthorized', 401);
  const mode = await loadAuthMode();
  if (mode === 'error') return error('failed', 503);
  if (mode !== 'both') return error('not_found', 404);
  const cfg = await loadOidcConfig();
  if (cfg === 'error') return error('failed', 503);
  const origin = appOrigin();
  if (!cfg.valid || origin === null) return error('not_configured', 400);
  if (!isSameOrigin(req, 'required', origin)) return error('failed', 403);
  const secret = await loadOidcClientSecret();
  if (secret === 'error') return error('failed', 503);
  if (!secret.found) return error('not_configured', 400);

  const state = randomState();
  const nonce = randomNonce();
  const codeVerifier = randomPKCECodeVerifier();
  let url: URL;
  try {
    const oidc = await getOidcConfiguration(cfg.issuer, cfg.clientId, secret.value);
    url = buildSsoAuthorizationUrl(oidc, {
      redirectUri: new URL('/api/auth/sso/callback', origin).href,
      state,
      nonce,
      codeChallenge: await calculatePKCECodeChallenge(codeVerifier),
      link: true,
    });
  } catch {
    return error('failed', 503);
  }
  const session = await bindableSession(req, claims);
  if (session instanceof NextResponse) return session;
  const res = NextResponse.json({ url: url.href });
  if (session.rotated) {
    setSessionCookies(
      res,
      session.rotated.accessToken,
      session.refreshToken,
      rememberMeOptsFromRequest(req),
    );
  }
  res.cookies.set(
    txnCookieName(state),
    await sealSsoTxn({
      purpose: 'link',
      state,
      nonce,
      code_verifier: codeVerifier,
      user_id: claims.user_id,
      session_hash: sessionHash(session.refreshToken),
    }),
    TXN_COOKIE_OPTS,
  );
  return res;
}

export const POST = withBffMetrics('accounts', '/accounts/api/sso/link', postHandler);
