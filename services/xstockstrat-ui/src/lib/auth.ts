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

// Server-readable marker that the current session opted into "Remember me". A browser sends only a
// cookie's name=value on subsequent requests — never its Max-Age — so the token-refresh paths
// (middleware in-process refresh + /api/auth/refresh) cannot otherwise tell a persistent session
// from a transient one, and would silently downgrade persistent cookies back to session cookies on
// the first rotation (the feature-153 regression this fixes). This marker is the only server-side
// record of that intent. It carries no secret and gates cookie *persistence* only, not authorization:
// a forged `remember_me=1` grants persistence bounded by the server refresh-token TTL and nothing
// more, so it needs no signing.
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

// refreshSession / revokeToken live in `identity.ts` — they import the Node-only Connect
// client. As of feature 128 `middleware.ts` runs in the Node.js runtime and calls
// `refreshSession()` in-process, so `identity.ts` is now reachable from middleware; it no
// longer needs to be kept out of an Edge bundle.

export function setSessionCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
  opts?: { maxAge?: number },
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const base = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };
  // With no maxAge the cookies stay session cookies (cleared on browser close) — the default.
  // When maxAge is supplied (extended session), both cookies become persistent (feature 153).
  const persistence = opts?.maxAge ? { maxAge: opts.maxAge } : {};
  res.cookies.set('access_token', accessToken, { ...base, ...persistence });
  res.cookies.set('refresh_token', refreshToken, { ...base, ...persistence });
  // Keep the remember-me marker in lockstep with the auth cookies so the refresh paths can re-apply
  // persistence on rotation. When persisted, its Max-Age rolls forward on every write, mirroring the
  // identity service's own refresh-token TTL rotation. When not persisted, wipe any stale marker left
  // by a prior remember-me login on this browser so a fresh transient login isn't treated as extended.
  if (opts?.maxAge) {
    res.cookies.set(REMEMBER_ME_COOKIE, '1', { ...base, maxAge: opts.maxAge });
  } else {
    res.cookies.set(REMEMBER_ME_COOKIE, '', { ...base, maxAge: 0 });
  }
}

// Resolve the persistence options to carry into a token refresh from the inbound request's
// remember-me marker. Present ⇒ re-apply the rolling extended-session Max-Age; absent ⇒ undefined
// (session cookies preserved). This is what stops a rotation from silently downgrading a persistent
// "Remember me" session — the browser never echoes a cookie's Max-Age, so this marker is the source.
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
