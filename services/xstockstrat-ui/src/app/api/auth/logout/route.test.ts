// C-12: session JWTs come from e2e/helpers/auth.ts; config results and origins are scenario one-offs.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signExpiredTestJwt, signTestJwt, TEST_JWT_SECRET } from '../../../../../e2e/helpers/auth';

const {
  revokeToken,
  loadAuthMode,
  loadOidcConfig,
  loadOidcClientSecret,
  resolveLogoutRedirect,
  recordAuthEvent,
} = vi.hoisted(() => ({
  revokeToken: vi.fn(),
  loadAuthMode: vi.fn(),
  loadOidcConfig: vi.fn(),
  loadOidcClientSecret: vi.fn(),
  resolveLogoutRedirect: vi.fn(),
  recordAuthEvent: vi.fn(),
}));
vi.mock('@/lib/identity', () => ({ revokeToken }));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode, loadOidcConfig, loadOidcClientSecret }));
vi.mock('@/lib/ssoLogout', () => ({ resolveLogoutRedirect }));
vi.mock('@/lib/bffMetrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bffMetrics')>()),
  recordAuthEvent,
}));

const { POST } = await import('./route');

const APP = 'https://xstockstrat-staging.example.test';
const ISSUER = 'https://auth.example.test';
const SIBLING = 'https://dashboard.example.test';
const PORTAL = `${ISSUER}/logout?rd=x`;
const CFG = {
  issuer: ISSUER,
  clientId: 'xstockstrat-staging-web',
  mcpClientIds: { claude: '', claudeReadonly: '', claudeCode: '', claudeCodeReadonly: '' },
  valid: true,
};

function logout(token: string | undefined, origin?: string): Promise<Response> {
  const headers: Record<string, string> = {
    cookie: [token ? `access_token=${token}` : '', 'sso_link=jwe'].filter(Boolean).join('; '),
  };
  if (origin !== undefined) headers.origin = origin;
  return POST(new NextRequest(`${APP}/api/auth/logout`, { method: 'POST', headers }));
}

const cleared = (res: Response) =>
  res.headers
    .getSetCookie()
    .filter((c) => c.includes('Max-Age=0'))
    .map((c) => c.split('=')[0])
    .sort();
const warns = (message: string) =>
  vi.mocked(console.warn).mock.calls.filter((c) => c[0] === message);
const configRead = () =>
  loadAuthMode.mock.calls.length +
  loadOidcConfig.mock.calls.length +
  loadOidcClientSecret.mock.calls.length;

let token: string;

beforeEach(async () => {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('APP_URL', APP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const m of [
    revokeToken,
    loadAuthMode,
    loadOidcConfig,
    loadOidcClientSecret,
    resolveLogoutRedirect,
    recordAuthEvent,
  ]) {
    m.mockReset();
  }
  revokeToken.mockResolvedValue(undefined);
  loadAuthMode.mockResolvedValue('both');
  loadOidcConfig.mockResolvedValue(CFG);
  loadOidcClientSecret.mockResolvedValue({ found: true, value: 'secret' });
  resolveLogoutRedirect.mockResolvedValue(PORTAL);
  token = await signTestJwt(['trader']);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('@AC-57 a sibling Origin → 403 in every mode', () => {
  test.each(['local', 'both', 'oidc'])('%s', async (mode) => {
    loadAuthMode.mockResolvedValue(mode);
    const res = await logout(token, SIBLING);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin mismatch' });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(revokeToken).not.toHaveBeenCalled();
    expect(configRead()).toBe(0);
    expect(warns('logout_origin_mismatch')).toEqual([
      ['logout_origin_mismatch', { origin_host: 'dashboard.example.test' }],
    ]);
    expect(recordAuthEvent.mock.calls).toEqual([['logout', 'cross_origin']]);
  });
});

test('@AC-58 an invalid APP_URL lets a sibling Origin through', async () => {
  vi.stubEnv('APP_URL', 'not a url');
  loadAuthMode.mockResolvedValue('local');
  const res = await logout(token, SIBLING);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test('@AC-53/@AC-52 both or oidc + valid config + verified → {ok:true, redirect}', async () => {
  for (const mode of ['both', 'oidc']) {
    loadAuthMode.mockResolvedValue(mode);
    resolveLogoutRedirect.mockClear();
    const res = await logout(token, APP);
    expect(await res.json()).toEqual({ ok: true, redirect: PORTAL });
    expect(resolveLogoutRedirect).toHaveBeenCalledWith(
      { issuer: ISSUER, clientId: CFG.clientId, appOrigin: APP },
      'secret',
    );
  }
  expect(revokeToken).toHaveBeenCalledTimes(2);
});

test('revoke iff verified (D-64): an unverified token is never revoked and gets no redirect', async () => {
  vi.stubEnv('JWT_SECRET', `${TEST_JWT_SECRET}-other`);
  const res = await logout(token);
  expect(await res.json()).toEqual({ ok: true });
  expect(revokeToken).not.toHaveBeenCalled();
  expect(recordAuthEvent.mock.calls).toEqual([['logout', 'unverified']]);
});

test('a verified token is revoked and records logout{verified}', async () => {
  await logout(token);
  expect(revokeToken).toHaveBeenCalledWith(token);
  expect(recordAuthEvent.mock.calls).toEqual([['logout', 'verified']]);
});

test('@AC-56 valid:false → {ok:true} with no redirect lookup', async () => {
  loadOidcConfig.mockResolvedValue({ ...CFG, valid: false });
  const res = await logout(token);
  expect(await res.json()).toEqual({ ok: true });
  expect(loadOidcClientSecret).not.toHaveBeenCalled();
  expect(resolveLogoutRedirect).not.toHaveBeenCalled();
});

test("@AC-62 mode 'error' → {ok:true} + WARN, revoke still done", async () => {
  loadAuthMode.mockResolvedValue('error');
  const res = await logout(token);
  expect(await res.json()).toEqual({ ok: true });
  expect(warns('sso_logout_mode_unknown')).toHaveLength(1);
  expect(revokeToken).toHaveBeenCalledWith(token);
  expect(loadOidcConfig).not.toHaveBeenCalled();
});

test("loadOidcConfig 'error' → {ok:true}", async () => {
  loadOidcConfig.mockResolvedValue('error');
  expect(await (await logout(token)).json()).toEqual({ ok: true });
  expect(resolveLogoutRedirect).not.toHaveBeenCalled();
});

test('@AC-64 an expired-but-signed access cookie → 200 {ok:true, …}, cookies cleared', async () => {
  const res = await logout(await signExpiredTestJwt());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, redirect: PORTAL });
  expect(cleared(res)).toEqual(['access_token', 'refresh_token', 'remember_me', 'sso_link']);
  expect(recordAuthEvent.mock.calls).toEqual([['logout', 'verified']]);
});

test.each([{ found: false }, 'error'])(
  'secret %o → the portal redirect (resolver gets null, D-134)',
  async (secret) => {
    loadOidcClientSecret.mockResolvedValue(secret);
    const res = await logout(token);
    expect(await res.json()).toEqual({ ok: true, redirect: PORTAL });
    expect(resolveLogoutRedirect).toHaveBeenCalledWith(expect.anything(), null);
  },
);

test('local → {ok:true} with no oidc config read', async () => {
  loadAuthMode.mockResolvedValue('local');
  expect(await (await logout(token)).json()).toEqual({ ok: true });
  expect(loadOidcConfig).not.toHaveBeenCalled();
});

describe('@AC-68 sso_link is cleared on every non-403 path', () => {
  test.each([
    ['local verified', 'local', true],
    ['both verified', 'both', true],
    ['error mode', 'error', true],
    ['no session cookie', 'both', false],
  ] as const)('%s', async (_name, mode, withToken) => {
    loadAuthMode.mockResolvedValue(mode);
    const res = await logout(withToken ? token : undefined);
    expect(res.status).toBe(200);
    expect(cleared(res)).toContain('sso_link');
    expect(cleared(res)).toContain('access_token');
  });
});
