import { NextRequest, NextResponse } from 'next/server';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { getSessionFromRequest } from '@/lib/auth';
import { withBffMetrics } from '@/lib/bffMetrics';
import { buildSsoAuthorizationUrl, getOidcConfiguration } from '@/lib/oidcClient';
import { loadAuthMode, loadOidcClientSecret, loadOidcConfig } from '@/lib/oidcConfig';
import { appOrigin, isSameOrigin } from '@/lib/sameOrigin';
import { sealSsoTxn, TXN_COOKIE_OPTS, txnCookieName } from '@/lib/ssoTxn';

const error = (code: string, status: number) => NextResponse.json({ error: code }, { status });

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
  const res = NextResponse.json({ url: url.href });
  res.cookies.set(
    txnCookieName(state),
    await sealSsoTxn({
      purpose: 'link',
      state,
      nonce,
      code_verifier: codeVerifier,
      user_id: claims.user_id,
    }),
    TXN_COOKIE_OPTS,
  );
  return res;
}

export const POST = withBffMetrics('accounts', '/accounts/api/sso/link', postHandler);
