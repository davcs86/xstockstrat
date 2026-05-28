import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookies } from '@/app/lib/auth';

const IDENTITY_ENDPOINT =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.email || !body.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${IDENTITY_ENDPOINT}/xstockstrat.identity.v1.IdentityService/AuthenticateUser`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/connect+json', 'Connect-Protocol-Version': '1' },
        body: JSON.stringify({ email: body.email, password: body.password }),
      }
    );
    if (res.status === 401) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    if (!res.ok) {
      console.error('[login] identity service returned', res.status);
      return NextResponse.json(
        { error: 'Authentication service unavailable. Please try again.' },
        { status: 503 },
      );
    }
    const data = await res.json();
    const response = NextResponse.json({ ok: true });
    setSessionCookies(response, data.accessToken, data.refreshToken);
    return response;
  } catch (err) {
    console.error('[login] identity service error:', err);
    return NextResponse.json(
      { error: 'Authentication service unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
