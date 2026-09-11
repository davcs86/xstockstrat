import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

// Stub the Node-only identity client so the middleware's in-process refresh path
// is driven without loading @connectrpc/connect-node. refreshSession is the exact
// symbol middleware.ts imports after feature 128 (Node.js-runtime middleware).
const refreshSession = vi.fn();
vi.mock('@/lib/identity', () => ({
  refreshSession: (...args: unknown[]) => refreshSession(...args),
  revokeToken: vi.fn(),
}));

import { config, middleware } from './middleware';

const TEST_SECRET = 'test-jwt-secret-value-at-least-32-bytes-long';

// The negative-lookahead matcher pattern is the second entry (the first, '/', is a literal).
function matches(pathname: string): boolean {
  const pattern = config.matcher[1] as string;
  return new RegExp(`^${pattern}$`).test(pathname);
}

/** Sign a near-expiry access token whose expires_at is inside the refresh threshold. */
async function signNearExpiryToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    user_id: 'u1',
    email: 'trader@example.com',
    roles: ['trader'],
    issued_at: nowSec,
    expires_at: nowSec + 30, // within ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS (60)
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(TEST_SECRET));
}

async function nearExpiryRequest(
  refreshToken = 'rt',
  opts: { rememberMe?: boolean } = {},
): Promise<NextRequest> {
  const access = await signNearExpiryToken();
  const cookie =
    `access_token=${access}; refresh_token=${refreshToken}` +
    (opts.rememberMe ? '; remember_me=1' : '');
  return new NextRequest(new URL('http://localhost/trader'), { headers: { cookie } });
}

describe('middleware matcher', () => {
  // @AC-5 — the exclusion now protects the route's LIVE browser caller
  // (src/lib/authRedirect.ts attemptRefresh), not a middleware self-call: matching
  // it would let middleware redirect that expired-token refresh POST to /auth/login,
  // regressing the durable @AC-5/@AC-6 guarantees (C-16).
  it('excludes api/auth/refresh — it retains a live browser caller in src/lib/authRedirect.ts', () => {
    expect(matches('/api/auth/refresh')).toBe(false);
  });

  it('still excludes the sibling auth/health paths', () => {
    expect(matches('/api/auth/login')).toBe(false);
    expect(matches('/api/health')).toBe(false);
    expect(matches('/auth/login')).toBe(false);
  });

  it('still matches a protected app route', () => {
    expect(matches('/trader/positions')).toBe(true);
  });
});

describe('middleware config runtime (@AC-1)', () => {
  it('runs on the Node.js runtime', () => {
    expect(config.runtime).toBe('nodejs');
  });

  it('still declares its route matcher', () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher).toContain('/');
  });
});

describe('middleware near-expiry refresh (@AC-2/@AC-3/@AC-4)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const ORIGINAL_SECRET = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    refreshSession.mockReset();
    // A resolvable fetch so the pre-change (loopback self-fetch) tree fails cleanly
    // on the behavioral assertions rather than throwing — RED is "refreshSession not
    // called / fetch WAS called", not a TypeError.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_SECRET;
  });

  // @AC-2: refreshed in-process, not via a self-fetch.
  it('calls refreshSession() with the refresh_token cookie and makes no self-fetch', async () => {
    refreshSession.mockResolvedValue({
      accessToken: 'newAccess',
      refreshToken: 'newRefresh',
      claims: { user_id: 'u1' },
    });
    const res = await middleware(await nearExpiryRequest('rt'));

    expect(refreshSession).toHaveBeenCalledWith('rt');
    expect(fetchSpy).not.toHaveBeenCalled();
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('access_token=newAccess'))).toBe(true);
  });

  // @AC-3: a transient (no remember-me) session stays session cookies through the rotation.
  it('sets rotated cookies via setSessionCookies with unchanged attributes (session cookies)', async () => {
    refreshSession.mockResolvedValue({
      accessToken: 'newAccess',
      refreshToken: 'newRefresh',
      claims: { user_id: 'u1' },
    });
    const res = await middleware(await nearExpiryRequest('rt'));

    const setCookies = res.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith('access_token='));
    const refresh = setCookies.find((c) => c.startsWith('refresh_token='));
    for (const cookie of [access, refresh]) {
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie!.toLowerCase()).toContain('samesite=lax');
      // no Max-Age ⇒ session cookie, matching the pre-change /api/auth/refresh flow
      expect(cookie!.toLowerCase()).not.toContain('max-age');
    }
    expect(access).toContain('access_token=newAccess');
    expect(refresh).toContain('refresh_token=newRefresh');
  });

  // @AC-2 regression guard: a remember-me session must NOT be downgraded to session cookies on the
  // near-expiry rotation. Before the fix, middleware called setSessionCookies without persistence, so
  // the first refresh (guaranteed after a redeploy/restart expired the access token) dropped Max-Age.
  it('preserves the extended-session Max-Age on rotation when the remember_me marker is present', async () => {
    refreshSession.mockResolvedValue({
      accessToken: 'newAccess',
      refreshToken: 'newRefresh',
      claims: { user_id: 'u1' },
    });
    const res = await middleware(await nearExpiryRequest('rt', { rememberMe: true }));

    const setCookies = res.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith('access_token='));
    const refresh = setCookies.find((c) => c.startsWith('refresh_token='));
    const marker = setCookies.find((c) => c.startsWith('remember_me='));
    for (const cookie of [access, refresh, marker]) {
      expect(cookie).toBeDefined();
      // Rolling 14-day window re-applied on every rotation (matches identity refresh-token TTL rotation).
      expect(cookie!.toLowerCase()).toContain('max-age=1209600');
    }
    expect(marker).toContain('remember_me=1');
  });

  // @AC-4: an expired/invalid session redirects to login with cookies cleared.
  it('redirects to /auth/login and clears cookies when refreshSession returns null', async () => {
    refreshSession.mockResolvedValue(null);
    const res = await middleware(await nearExpiryRequest('rt'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
    const setCookies = res.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith('access_token='));
    const refresh = setCookies.find((c) => c.startsWith('refresh_token='));
    expect(access).toContain('Max-Age=0');
    expect(refresh).toContain('Max-Age=0');
  });
});

describe('middleware expired-token refresh (@AC-5/@AC-6)', () => {
  const ORIGINAL_SECRET = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    refreshSession.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_SECRET;
  });

  /** Build a request with a fully-expired access token (jose will reject it) and a refresh cookie. */
  async function expiredRequest(
    refreshToken = 'rt',
    opts: { rememberMe?: boolean } = {},
  ): Promise<NextRequest> {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredAccess = await new SignJWT({
      user_id: 'u1',
      email: 'trader@example.com',
      roles: ['trader'],
      issued_at: nowSec - 1800,
      expires_at: nowSec - 900, // fully expired 15 min ago
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(nowSec - 900)
      .sign(new TextEncoder().encode(TEST_SECRET));

    const cookie =
      `access_token=${expiredAccess}; refresh_token=${refreshToken}` +
      (opts.rememberMe ? '; remember_me=1' : '');
    return new NextRequest(new URL('http://localhost/trader'), { headers: { cookie } });
  }

  // @AC-5: a fully-expired access token with a valid refresh token should refresh, not redirect.
  it('refreshes in-process when the access token is fully expired but a refresh_token exists', async () => {
    refreshSession.mockResolvedValue({
      accessToken: 'newAccess',
      refreshToken: 'newRefresh',
      claims: { user_id: 'u1' },
    });
    const res = await middleware(await expiredRequest('rt'));

    expect(refreshSession).toHaveBeenCalledWith('rt');
    // Should proceed (not redirect) — status 200.
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('access_token=newAccess'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('refresh_token=newRefresh'))).toBe(true);
  });

  // Preserves remember-me persistence through the expired-token refresh path.
  it('preserves remember-me Max-Age when refreshing a fully-expired token', async () => {
    refreshSession.mockResolvedValue({
      accessToken: 'newAccess',
      refreshToken: 'newRefresh',
      claims: { user_id: 'u1' },
    });
    const res = await middleware(await expiredRequest('rt', { rememberMe: true }));

    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith('access_token='));
    expect(access).toBeDefined();
    expect(access!.toLowerCase()).toContain('max-age=1209600');
  });

  // @AC-6: expired access + failed refresh → redirect to login with cookies cleared.
  it('redirects to login and clears cookies when both access and refresh tokens are dead', async () => {
    refreshSession.mockResolvedValue(null);
    const res = await middleware(await expiredRequest('rt'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
    expect(res.headers.get('location')).toContain('redirect=%2Ftrader');
    const setCookies = res.headers.getSetCookie();
    const access = setCookies.find((c) => c.startsWith('access_token='));
    const refresh = setCookies.find((c) => c.startsWith('refresh_token='));
    expect(access).toContain('Max-Age=0');
    expect(refresh).toContain('Max-Age=0');
  });

  // No refresh_token cookie at all → redirect without attempting refresh.
  it('redirects without calling refreshSession when no refresh_token cookie is present', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredAccess = await new SignJWT({
      user_id: 'u1',
      email: 'trader@example.com',
      roles: ['trader'],
      issued_at: nowSec - 1800,
      expires_at: nowSec - 900,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(nowSec - 900)
      .sign(new TextEncoder().encode(TEST_SECRET));

    const req = new NextRequest(new URL('http://localhost/trader'), {
      headers: { cookie: `access_token=${expiredAccess}` },
    });
    const res = await middleware(req);

    expect(refreshSession).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login');
  });
});
