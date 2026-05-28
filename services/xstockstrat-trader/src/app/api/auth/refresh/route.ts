import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, setSessionCookies } from '@/lib/auth';
import { refreshSession } from '@/lib/identity';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh_token')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await refreshSession(refreshToken);
  if (!result) {
    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, result.accessToken, result.refreshToken);
  return response;
}
