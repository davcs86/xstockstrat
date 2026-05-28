import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { identityClient } from '@/lib/connectClients';
import { setSessionCookies } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.email || !body.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  try {
    const data = (await identityClient.authenticateUser({
      email: body.email,
      password: body.password,
    })) as any;
    const response = NextResponse.json({ ok: true });
    setSessionCookies(
      response,
      data.accessToken,
      data.refreshToken,
    );
    return response;
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    console.error('[login] identity service error:', err);
    return NextResponse.json(
      { error: 'Authentication service unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
