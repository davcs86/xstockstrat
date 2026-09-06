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

// Extended-session ("Remember me") cookie lifetime. MUST stay <= identity's
// identity.jwt.refresh_ttl_seconds (default 30d) or a persisted cookie outlives its refresh token.
export const REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600; // 14 days

// Marker that the session opted into "Remember me" — the browser never echoes a cookie's Max-Age,
// so it's the only persistence signal. Gates persistence only, not authorization — needs no signing.
export const REMEMBER_ME_COOKIE = 'remember_me';

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

// refreshSession / revokeToken live in identity.ts (Node-only Connect client); middleware runs in
// the Node.js runtime and calls refreshSession() in-process.

export function setSessionCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
  opts?: { maxAge?: number },
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const base = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };
  // No maxAge → session cookies (cleared on browser close); maxAge → persistent (extended session).
  const persistence = opts?.maxAge ? { maxAge: opts.maxAge } : {};
  res.cookies.set('access_token', accessToken, { ...base, ...persistence });
  res.cookies.set('refresh_token', refreshToken, { ...base, ...persistence });
  // Keep the remember-me marker in lockstep with the auth cookies; on a transient login wipe any
  // stale marker so a fresh session isn't treated as extended.
  if (opts?.maxAge) {
    res.cookies.set(REMEMBER_ME_COOKIE, '1', { ...base, maxAge: opts.maxAge });
  } else {
    res.cookies.set(REMEMBER_ME_COOKIE, '', { ...base, maxAge: 0 });
  }
}

// Persistence options for a token refresh, from the request's remember-me marker: present → re-apply
// the extended Max-Age, absent → undefined. Stops a rotation from downgrading a persistent session.
export function rememberMeOptsFromRequest(req: NextRequest): { maxAge: number } | undefined {
  return req.cookies.get(REMEMBER_ME_COOKIE)?.value === '1'
    ? { maxAge: REMEMBER_ME_MAX_AGE_SECONDS }
    : undefined;
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set('access_token', '', { maxAge: 0, path: '/' });
  res.cookies.set('refresh_token', '', { maxAge: 0, path: '/' });
  res.cookies.set(REMEMBER_ME_COOKIE, '', { maxAge: 0, path: '/' });
}

// ADMIN_SCOPE is the single source of truth for the admin bit — BFF admin gates reference it, and
// the DRY guard rail bans the raw 0x04 literal everywhere except this file.
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
