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

// Extended-session ("Remember me") cookie lifetime. When the operator opts in at login, the auth
// cookies are written as persistent cookies with this Max-Age instead of session cookies, so the
// session survives a browser restart (feature 153).
//
// MUST stay <= identity's `identity.jwt.refresh_ttl_seconds` (default 2592000s / 30d) — otherwise a
// persisted cookie could outlive the server-side refresh token it points at. The UI has no runtime
// read of that config value, so this bound is a documented operational coupling, NOT a
// runtime-enforced invariant: if an operator lowers `identity.jwt.refresh_ttl_seconds` below this,
// lower this constant to match. 14 days is well under the 30-day default.
export const REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600; // 14 days

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

/**
 * Loopback URL for middleware's self-referential call to `/api/auth/refresh`.
 *
 * Must NOT be built from the inbound request's own origin (`new URL(path, req.url)`):
 * on DigitalOcean App Platform that origin is the app's public `https://` domain, and a
 * container calling back out to its own public domain is intermittently routed over the
 * platform's internal (plain-HTTP) network instead of back out through TLS termination —
 * the https:// ClientHello then hits a non-TLS responder and fails with
 * ERR_SSL_WRONG_VERSION_NUMBER. The Next.js server always listens on plain HTTP on PORT
 * (default 3000 — see Dockerfile `EXPOSE 3000`), so loop back there directly instead.
 */
export function buildInternalRefreshUrl(): URL {
  const port = process.env.PORT ?? '3000';
  return new URL(`http://127.0.0.1:${port}/api/auth/refresh`);
}

export function setSessionCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
  opts?: { maxAge?: number },
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  // With no maxAge the cookies stay session cookies (cleared on browser close) — the default.
  // When maxAge is supplied (extended session), both cookies become persistent (feature 153).
  const persistence = opts?.maxAge ? { maxAge: opts.maxAge } : {};
  res.cookies.set('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    ...persistence,
  });
  res.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    ...persistence,
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
