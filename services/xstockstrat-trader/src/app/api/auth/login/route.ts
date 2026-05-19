import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookies } from '@/lib/auth';

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
        headers: { 'Content-Type': 'application/connect+json' },
        body: JSON.stringify({ email: body.email, password: body.password }),
      }
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    const data = await res.json();
    const response = NextResponse.json({ ok: true });
    setSessionCookies(response, data.access_token, data.refresh_token);
    return response;
  } catch {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
  }
}
