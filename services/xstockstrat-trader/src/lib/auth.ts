import { jwtVerify } from 'jose';
import type { NextRequest, NextResponse } from 'next/server';
import { identityClient } from '@/lib/connectClients';

export interface JwtClaims {
  user_id: string;
  email: string;
  roles: string[];
  issued_at: number;
  expires_at: number;
}

export const ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60;

export async function verifyAccessToken(token: string): Promise<JwtClaims | null> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload as unknown as JwtClaims;
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(req: NextRequest): Promise<JwtClaims | null> {
  const token = req.cookies.get('access_token')?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function refreshSession(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null> {
  try {
    const data = (await identityClient.refreshToken({ refreshToken })) as any;
    return {
      accessToken: data.access_token ?? data.accessToken,
      refreshToken: data.refresh_token ?? data.refreshToken,
      claims: data.claims,
    };
  } catch {
    return null;
  }
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await identityClient.revokeToken({ token });
  } catch {
    // best-effort revocation
  }
}

export function setSessionCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookies.set('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
  res.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set('access_token', '', { maxAge: 0, path: '/' });
  res.cookies.set('refresh_token', '', { maxAge: 0, path: '/' });
}

export function rolesToAccessScope(roles: string[]): number {
  const READ = 0x01;
  const WRITE = 0x02;
  const ADMIN = 0x04;
  const TRADING = 0x08;
  let scope = 0;
  for (const role of roles) {
    if (role === 'viewer') scope |= READ;
    else if (role === 'trader') scope |= READ | WRITE | TRADING;
    else if (role === 'admin') scope |= READ | WRITE | ADMIN | TRADING;
  }
  return scope;
}

export function generateTraceId(): string {
  return crypto.randomUUID();
}
