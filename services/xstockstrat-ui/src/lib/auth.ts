import { jwtVerify } from 'jose';
import type { NextRequest, NextResponse } from 'next/server';

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

// refreshSession / revokeToken live in `identity.ts` — they import the
// Node-only Connect client and must not be reachable from middleware,
// which Next.js bundles for the Edge runtime.

export function setSessionCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
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

// Access-scope bitmap. ADMIN_SCOPE is the single source of truth for the admin bit —
// BFF admin gates (requireAdminScope in bffShared.ts) reference it instead of inlining 0x04.
// The DRY guard rail bans the raw 0x04 literal everywhere except this file.
export const ADMIN_SCOPE = 0x04;

export function rolesToAccessScope(roles: string[]): number {
  const READ = 0x01;
  const WRITE = 0x02;
  const TRADING = 0x08;
  let scope = 0;
  for (const role of roles) {
    if (role === 'viewer') scope |= READ;
    else if (role === 'trader') scope |= READ | WRITE | TRADING;
    else if (role === 'admin') scope |= READ | WRITE | ADMIN_SCOPE | TRADING;
  }
  return scope;
}

/** True when the given roles grant the admin scope bit. */
export function hasAdminScope(roles: string[]): boolean {
  return (rolesToAccessScope(roles) & ADMIN_SCOPE) !== 0;
}

export function generateTraceId(): string {
  return crypto.randomUUID();
}
