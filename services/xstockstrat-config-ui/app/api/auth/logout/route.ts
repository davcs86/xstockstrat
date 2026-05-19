import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, revokeToken } from '@/app/lib/auth';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('access_token')?.value;
  if (token) {
    await revokeToken(token);
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
