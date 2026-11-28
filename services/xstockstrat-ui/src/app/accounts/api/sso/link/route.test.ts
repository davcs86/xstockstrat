// C-12: user ids from e2e/fixtures/users.ts, session JWTs from e2e/helpers/auth.ts; issuer, origins
// and config results are scenario one-offs.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { ClientSecretBasic, Configuration } from 'openid-client';
import { signTestJwt, TEST_JWT_SECRET } from '../../../../../../e2e/helpers/auth';
import { TEST_USER_B_ID, TEST_USER_ID } from '../../../../../../e2e/fixtures/users';
import { openSsoTxn, txnCookieName } from '@/lib/ssoTxn';

const { loadAuthMode, loadOidcConfig, loadOidcClientSecret, getOidcConfiguration } = vi.hoisted(
  () => ({
    loadAuthMode: vi.fn(),
    loadOidcConfig: vi.fn(),
    loadOidcClientSecret: vi.fn(),
    getOidcConfiguration: vi.fn(),
  }),
);
const { refreshSession } = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode, loadOidcConfig, loadOidcClientSecret }));
vi.mock('@/lib/identity', () => ({ refreshSession }));
vi.mock('@/lib/oidcClient', async (orig) => ({
  ...(await orig<typeof import('@/lib/oidcClient')>()),
  getOidcConfiguration,
}));

const { POST } = await import('./route');

const APP = 'http://localhost:3000';
const ISSUER = 'https://auth.example.test';
const SIBLING = 'https://dashboard.example.test';
const CLIENT_ID = 'xstockstrat-staging-web';
const CFG = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  mcpClientIds: { claude: '', claudeReadonly: '', claudeCode: '', claudeCodeReadonly: '' },
  valid: true,
};

const REFRESH = 'rt-1';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// A session JWT with an explicit lifetime: `ttl` total, `left` seconds remaining.
async function sessionJwt(ttl: number, left = ttl): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    user_id: TEST_USER_ID,
    email: 'trader@example.test',
    roles: ['trader'],
    issued_at: now + left - ttl,
    expires_at: now + left,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

async function link(
  opts: { token?: string; origin?: string | null; body?: string; refresh?: string | null } = {},
): Promise<Response> {
  const token = opts.token ?? (await signTestJwt(['trader']));
  const refresh = opts.refresh === undefined ? REFRESH : opts.refresh;
  const headers: Record<string, string> = {
    cookie: `access_token=${token}` + (refresh === null ? '' : `; refresh_token=${refresh}`),
  };
  const origin = opts.origin === undefined ? APP : opts.origin;
  if (origin !== null) headers.origin = origin;
  return POST(
    new NextRequest(`${APP}/accounts/api/sso/link`, { method: 'POST', headers, body: opts.body }),
  );
}

const expectError = async (res: Response, status: number, error: string) => {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
};

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('APP_URL', APP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const m of [
    loadAuthMode,
    loadOidcConfig,
    loadOidcClientSecret,
    getOidcConfiguration,
    refreshSession,
  ]) {
    m.mockReset();
  }
  loadAuthMode.mockResolvedValue('both');
  loadOidcConfig.mockResolvedValue(CFG);
  loadOidcClientSecret.mockResolvedValue({ found: true, value: 'secret' });
  getOidcConfiguration.mockResolvedValue(
    new Configuration(
      { issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/oidc/authorization` },
      CLIENT_ID,
      undefined,
      ClientSecretBasic('secret'),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('@AC-77 handler rows', () => {
  test('FR-16.6 a stale session token → 401', async () => {
    await expectError(await link({ token: 'not-a-jwt' }), 401, 'unauthorized');
    expect(loadAuthMode).not.toHaveBeenCalled();
  });

  test('row 4: a sibling Origin → 403 failed', async () => {
    await expectError(await link({ origin: SIBLING }), 403, 'failed');
    expect(loadOidcClientSecret).not.toHaveBeenCalled();
  });

  test('a missing Origin → 403 failed', async () => {
    await expectError(await link({ origin: null }), 403, 'failed');
  });

  test('row 5: client_id "" → 400 not_configured', async () => {
    loadOidcConfig.mockResolvedValue({ ...CFG, clientId: '', valid: false });
    await expectError(await link(), 400, 'not_configured');
  });

  test('row 6: secret unset + a sibling Origin → 403 (Origin before secret)', async () => {
    loadOidcClientSecret.mockResolvedValue({ found: false });
    await expectError(await link({ origin: SIBLING }), 403, 'failed');
  });

  test('row 7: secret unset from the same origin → 400 not_configured', async () => {
    loadOidcClientSecret.mockResolvedValue({ found: false });
    await expectError(await link(), 400, 'not_configured');
  });
});

describe('faults → 503 failed', () => {
  test.each([
    ['mode', () => loadAuthMode.mockResolvedValue('error')],
    ['ui config', () => loadOidcConfig.mockResolvedValue('error')],
    ['secret', () => loadOidcClientSecret.mockResolvedValue('error')],
    ['discovery', () => getOidcConfiguration.mockRejectedValue(new Error('down'))],
  ])('%s', async (_, arrange) => {
    arrange();
    await expectError(await link(), 503, 'failed');
  });
});

test.each(['local', 'oidc'])('@AC-69 %s → 404 not_found', async (mode) => {
  loadAuthMode.mockResolvedValue(mode);
  await expectError(await link(), 404, 'not_found');
  expect(loadOidcConfig).not.toHaveBeenCalled();
});

describe('happy path', () => {
  test('200 {url} with prompt=login&max_age=1 (D-139) and the link txn', async () => {
    const res = await link();
    expect(res.status).toBe(200);
    const { url } = await res.json();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/api/oidc/authorization`);
    expect(u.searchParams.get('prompt')).toBe('login');
    expect(u.searchParams.get('max_age')).toBe('1');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/sso/callback`);
    const state = u.searchParams.get('state')!;
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${txnCookieName(state)}=`))!;
    expect(cookie).toContain('Path=/api/auth/sso/callback');
    const txn = await openSsoTxn(cookie.split(';')[0].slice(txnCookieName(state).length + 1));
    expect(txn).toMatchObject({
      purpose: 'link',
      state,
      nonce: u.searchParams.get('nonce'),
      user_id: TEST_USER_ID,
    });
  });

  test("the txn's user_id is the session's, never a body value", async () => {
    const res = await link({
      body: JSON.stringify({ user_id: TEST_USER_B_ID, userId: TEST_USER_B_ID }),
    });
    const state = new URL((await res.json()).url).searchParams.get('state')!;
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(txnCookieName(state)))!;
    const txn = await openSsoTxn(cookie.split(';')[0].slice(txnCookieName(state).length + 1));
    expect(txn).toMatchObject({ purpose: 'link', user_id: TEST_USER_ID });
  });
});

// The txn cookie's sealed payload, or null when the response set none.
async function sealedTxn(res: Response) {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sso_txn_'));
  return cookie ? openSsoTxn(cookie.split(';')[0].split('=').slice(1).join('=')) : null;
}

describe('370 session binding (@AC-5/@AC-6/@AC-7)', () => {
  test('@AC-5 the txn carries SHA-256 of the session refresh token; no rotation with time to spare', async () => {
    const res = await link({ token: await sessionJwt(900, 700) });
    expect(res.status).toBe(200);
    expect(await sealedTxn(res)).toMatchObject({ session_hash: sha256(REFRESH) });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  test('no refresh_token cookie → 401, no txn', async () => {
    const res = await link({ refresh: null });
    await expectError(res, 401, 'unauthorized');
    expect(await sealedTxn(res)).toBeNull();
  });

  test('@AC-6 under 660 s left → rotate first, set the rotated cookies, bind the new token', async () => {
    refreshSession.mockResolvedValue({
      accessToken: await sessionJwt(900),
      refreshToken: 'rt-2',
      claims: {},
    });
    const res = await link({ token: await sessionJwt(900, 659) });
    expect(res.status).toBe(200);
    expect(refreshSession).toHaveBeenCalledWith(REFRESH);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('refresh_token=rt-2'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('access_token=ey'))).toBe(true);
    expect(await sealedTxn(res)).toMatchObject({ session_hash: sha256('rt-2') });
  });

  test('@AC-6 a failed pre-rotation → 401, no txn', async () => {
    refreshSession.mockResolvedValue(null);
    const res = await link({ token: await sessionJwt(900, 100) });
    await expectError(res, 401, 'unauthorized');
    expect(await sealedTxn(res)).toBeNull();
  });

  test.each([
    ['the session token', async () => link({ token: await sessionJwt(300) })],
    [
      'the rotated token',
      async () => {
        refreshSession.mockResolvedValue({
          accessToken: await sessionJwt(300),
          refreshToken: 'rt-2',
          claims: {},
        });
        return link({ token: await sessionJwt(900, 100) });
      },
    ],
  ])('@AC-7 an access TTL under 660 s on %s → 503 failed, no txn, logged', async (_, act) => {
    const res = await act();
    await expectError(res, 503, 'failed');
    expect(await sealedTxn(res)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith('sso_link_refused', {
      reason: 'access_ttl_too_short',
    });
  });
});
