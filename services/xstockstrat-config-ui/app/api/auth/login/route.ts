import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { identityClient } from '@/app/lib/connectClients';
import { setSessionCookies } from '@/app/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.email || !body.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  try {
    const data = await identityClient.authenticateUser({
      email: body.email,
      password: body.password,
    });
    const tokens = data as any;
    const response = NextResponse.json({ ok: true });
    setSessionCookies(
      response,
      tokens.accessToken,
      tokens.refreshToken,
    );
    return response;
  } catch (err) {
    if (ConnectError) {
      const ce = ConnectError.from(err);
      if (ce.code === Code.Unauthenticated) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
    }
    // Service unavailable — don't leak internal error detail to the browser.
    console.error('[login] identity service error:', (err as Error)?.stack ?? err);
    return NextResponse.json(
      { error: 'Authentication service unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
