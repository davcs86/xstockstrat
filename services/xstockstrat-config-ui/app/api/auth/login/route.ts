import { NextRequest, NextResponse } from 'next/server';
import { identityClient } from '@/app/lib/connectClients';
import { setSessionCookies } from '@/app/lib/auth';

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
      data.access_token ?? data.accessToken,
      data.refresh_token ?? data.refreshToken,
    );
    return response;
  } catch (err) {
    // Preserve the original opaque-failure behaviour: any upstream failure renders as 401.
    void err;
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
}
