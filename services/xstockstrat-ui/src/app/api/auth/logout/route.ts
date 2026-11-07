import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/auth';
import { revokeToken } from '@/lib/identity';
import { recordAuthEvent, withBffMetrics } from '@/lib/bffMetrics';

async function postHandler(req: NextRequest) {
  const token = req.cookies.get('access_token')?.value;
  if (token) {
    await revokeToken(token);
  }
  recordAuthEvent('logout');
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}

export const POST = withBffMetrics('auth', '/api/auth/logout', postHandler);
