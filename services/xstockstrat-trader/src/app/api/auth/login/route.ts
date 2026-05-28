import { NextRequest, NextResponse } from 'next/server';
import { identityClient } from '@/lib/connectClients';
import { setSessionCookies } from '@/lib/auth';

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
    // Preserve the original behaviour: any upstream failure renders as 401.
    // ConnectError detail is intentionally not surfaced to the client.
    void err;
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
}
