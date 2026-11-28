// C-12: JWT secret from e2e/helpers/auth.ts; issuer, origins and config results are scenario one-offs.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ClientSecretBasic, Configuration } from 'openid-client';
import { TEST_JWT_SECRET } from '../../../../../../e2e/helpers/auth';
import { openSsoTxn, txnCookieName } from '@/lib/ssoTxn';

const {
  loadAuthMode,
  loadOidcConfig,
  loadOidcClientSecret,
  getOidcConfiguration,
  recordAuthEvent,
} = vi.hoisted(() => ({
  loadAuthMode: vi.fn(),
  loadOidcConfig: vi.fn(),
  loadOidcClientSecret: vi.fn(),
  getOidcConfiguration: vi.fn(),
  recordAuthEvent: vi.fn(),
}));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode, loadOidcConfig, loadOidcClientSecret }));
vi.mock('@/lib/oidcClient', async (orig) => ({
  ...(await orig<typeof import('@/lib/oidcClient')>()),
  getOidcConfiguration,
}));
vi.mock('@/lib/bffMetrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bffMetrics')>()),
  recordAuthEvent,
}));

const route: Record<string, unknown> = await import('./route');
const POST = route.POST as (req: NextRequest) => Promise<Response>;

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

function start(form: Record<string, string> = {}, origin: string | null = APP): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (origin !== null) headers.origin = origin;
  return POST(
    new NextRequest(`${APP}/api/auth/sso/start`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(form).toString(),
    }),
  );
}

const location = (res: Response) => res.headers.get('location');

function cookieValue(res: Response, name: string): string | undefined {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`));
  return c?.slice(name.length + 1).split(';')[0];
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('APP_URL', APP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
  for (const m of [
    loadAuthMode,
    loadOidcConfig,
    loadOidcClientSecret,
    getOidcConfiguration,
    recordAuthEvent,
  ]) {
    m.mockReset();
  }
  loadAuthMode.mockResolvedValue('oidc');
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

test('@AC-47 local → 404, no IdP request', async () => {
  loadAuthMode.mockResolvedValue('local');
  const res = await start();
  expect(res.status).toBe(404);
  expect(getOidcConfiguration).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('@AC-60 mode unreadable → login failed as a fault', async () => {
  loadAuthMode.mockResolvedValue('error');
  const res = await start();
  expect(res.status).toBe(303);
  expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
  expect(recordAuthEvent.mock.calls).toEqual([['sso_login_error']]);
});

test('@AC-60 ui config unreadable → login failed', async () => {
  loadOidcConfig.mockResolvedValue('error');
  const res = await start();
  expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
});

test('@AC-54 invalid web config → not_configured before the Origin check, no IdP request', async () => {
  loadOidcConfig.mockResolvedValue({ ...CFG, issuer: 'http://auth.example.test', valid: false });
  const res = await start({}, SIBLING);
  expect(res.status).toBe(303);
  expect(location(res)).toBe(`${APP}/auth/login?error=not_configured`);
  expect(loadOidcClientSecret).not.toHaveBeenCalled();
  expect(getOidcConfiguration).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(recordAuthEvent.mock.calls).toEqual([['sso_login_failed', 'not_configured']]);
});

test('@AC-58 invalid APP_URL → relative not_configured whatever the Origin', async () => {
  vi.stubEnv('APP_URL', 'not a url');
  loadOidcConfig.mockResolvedValue({ ...CFG, valid: false });
  for (const origin of [APP, SIBLING, null]) {
    const res = await start({}, origin);
    expect(location(res)).toBe('/auth/login?error=not_configured');
  }
});

describe('@AC-59 Origin', () => {
  test.each([
    ['sibling', SIBLING],
    ['missing', null],
  ])('%s Origin → failed', async (_, origin) => {
    const res = await start({}, origin);
    expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
    expect(loadOidcClientSecret).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('GET is not exported, so Next answers 405', () => {
    expect(route.GET).toBeUndefined();
  });
});

test('secret unset → not_configured; secret fault → failed', async () => {
  loadOidcClientSecret.mockResolvedValue({ found: false });
  expect(location(await start())).toBe(`${APP}/auth/login?error=not_configured`);
  loadOidcClientSecret.mockResolvedValue('error');
  expect(location(await start())).toBe(`${APP}/auth/login?error=failed`);
  expect(recordAuthEvent.mock.calls).toEqual([
    ['sso_login_failed', 'not_configured'],
    ['sso_login_error'],
  ]);
  expect(getOidcConfiguration).not.toHaveBeenCalled();
});

test('discovery fault → failed as a fault', async () => {
  getOidcConfiguration.mockRejectedValue(new Error('discovery down'));
  const res = await start();
  expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
  expect(recordAuthEvent.mock.calls).toEqual([['sso_login_error']]);
});

describe('happy path', () => {
  test('303 to the authorize URL + a login txn with remember=true for remember=1', async () => {
    const res = await start({ remember: '1', redirect: '/insights/x' });
    expect(res.status).toBe(303);
    const url = new URL(location(res)!);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/api/oidc/authorization`);
    const q = url.searchParams;
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('openid email profile');
    expect(q.get('response_mode')).toBe('query');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('redirect_uri')).toBe('http://localhost:3000/api/auth/sso/callback');
    expect(q.get('prompt')).toBeNull();
    expect(q.get('max_age')).toBeNull();
    const state = q.get('state')!;
    expect(state).toBeTruthy();
    expect(getOidcConfiguration).toHaveBeenCalledWith(ISSUER, CLIENT_ID, 'secret');

    const jwe = cookieValue(res, txnCookieName(state));
    expect(jwe).toBeTruthy();
    const txn = await openSsoTxn(jwe!);
    expect(txn).toMatchObject({
      purpose: 'login',
      state,
      nonce: q.get('nonce'),
      remember: true,
      redirect: '/insights/x',
    });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(txnCookieName(state)))!;
    expect(cookie).toContain('Path=/api/auth/sso/callback');
    expect(cookie).toContain('HttpOnly');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('no remember → remember=false; an off-site redirect falls back to /trader', async () => {
    const res = await start({ redirect: 'https://evil.example.test' });
    const state = new URL(location(res)!).searchParams.get('state')!;
    const txn = await openSsoTxn(cookieValue(res, txnCookieName(state))!);
    expect(txn).toMatchObject({ purpose: 'login', remember: false, redirect: '/trader' });
  });
});
