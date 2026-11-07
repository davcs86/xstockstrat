import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { identityClient } from '@/lib/connectClients';
import { serverLog } from '@/lib/serverLog';
import { recordAuthEvent, withBffMetrics } from '@/lib/bffMetrics';
import { setSessionCookies, REMEMBER_ME_MAX_AGE_SECONDS } from '@/lib/auth';

async function postHandler(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.email || !body.password) {
    recordAuthEvent('login_invalid_request');
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  try {
    const data = await identityClient.authenticateUser({
      email: body.email,
      password: body.password,
    });
    const response = NextResponse.json({ ok: true });
    // Extended session ("Remember me"): persistent cookies when opted in, else session cookies.
    setSessionCookies(
      response,
      data.accessToken,
      data.refreshToken,
      body.rememberMe ? { maxAge: REMEMBER_ME_MAX_AGE_SECONDS } : undefined,
    );
    recordAuthEvent('login_ok');
    return response;
  } catch (err) {
    // Connect code only — never the email or password.
    const code = ConnectError.from(err).code;
    if (code === Code.Unauthenticated) {
      recordAuthEvent('login_failed');
      serverLog.warn('[login] credentials rejected', { code: Code[code] });
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    recordAuthEvent('login_error');
    // Service unavailable — don't leak internal error detail to the browser.
    serverLog.error('[login] identity service error', { code: Code[code] });
    return NextResponse.json(
      { error: 'Authentication service unavailable. Please try again.' },
      { status: 503 },
    );
  }
}

export const POST = withBffMetrics('auth', '/api/auth/login', postHandler);
