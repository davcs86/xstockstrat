import { NextRequest, NextResponse } from 'next/server';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { withBffMetrics } from '@/lib/bffMetrics';
import { buildSsoAuthorizationUrl, getOidcConfiguration } from '@/lib/oidcClient';
import { loadAuthMode, loadOidcClientSecret, loadOidcConfig } from '@/lib/oidcConfig';
import { safeRedirect } from '@/lib/safeRedirect';
import { appOrigin, isSameOrigin } from '@/lib/sameOrigin';
import { ssoErrorRedirect, type SsoErrorCode } from '@/lib/ssoErrors';
import { sealSsoTxn, TXN_COOKIE_OPTS, txnCookieName } from '@/lib/ssoTxn';

// POST only: a GET would let a cross-site link start a login (D-46, D-54); Next answers it 405.
async function postHandler(req: NextRequest) {
  const origin = appOrigin();
  const fail = (code: SsoErrorCode, fault = false) =>
    ssoErrorRedirect({ dest: 'login', code }, origin, { fault });

  const mode = await loadAuthMode();
  if (mode === 'local') return new NextResponse(null, { status: 404 });
  if (mode === 'error') return fail('failed', true);
  const cfg = await loadOidcConfig();
  if (cfg === 'error') return fail('failed', true);
  if (!cfg.valid || origin === null) return fail('not_configured');
  if (!isSameOrigin(req, 'required', origin)) return fail('failed');
  const secret = await loadOidcClientSecret();
  if (secret === 'error') return fail('failed', true);
  if (!secret.found) return fail('not_configured');

  const form = await req.formData().catch(() => null);
  const remember = form?.get('remember') === '1';
  const redirectField = form?.get('redirect');
  const redirect = safeRedirect(typeof redirectField === 'string' ? redirectField : null);

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
    });
  } catch {
    return fail('failed', true);
  }
  const res = new NextResponse(null, { status: 303, headers: { location: url.href } });
  res.cookies.set(
    txnCookieName(state),
    await sealSsoTxn({
      purpose: 'login',
      state,
      nonce,
      code_verifier: codeVerifier,
      remember,
      redirect,
    }),
    TXN_COOKIE_OPTS,
  );
  return res;
}

export const POST = withBffMetrics('auth', '/api/auth/sso/start', postHandler);
