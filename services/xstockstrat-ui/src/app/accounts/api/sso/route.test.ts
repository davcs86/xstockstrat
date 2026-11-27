// C-12: user ids from e2e/fixtures/users.ts, session JWTs from e2e/helpers/auth.ts; issuers, labels
// and Connect errors are scenario one-offs.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';
import { signTestJwt, TEST_JWT_SECRET } from '../../../../../e2e/helpers/auth';
import {
  TEST_USER_B_EMAIL,
  TEST_USER_B_ID,
  TEST_USER_EMAIL,
  TEST_USER_ID,
} from '../../../../../e2e/fixtures/users';
import { HEADER_USER_ID } from '@/lib/headers';
import { sealSsoLink } from '@/lib/ssoTxn';

const { loadAuthMode, loadOidcConfig, getExternalIdentityLinks } = vi.hoisted(() => ({
  loadAuthMode: vi.fn(),
  loadOidcConfig: vi.fn(),
  getExternalIdentityLinks: vi.fn(),
}));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode, loadOidcConfig }));
vi.mock('@/lib/connectClients', () => ({ identityClient: { getExternalIdentityLinks } }));

const { GET } = await import('./route');

const APP = 'http://localhost:3000';
const ISSUER = 'https://auth.example.test';
const OTHER_ISSUER = 'https://auth-other.example.test';
const NOW_S = 1_800_000_000;
const CFG = {
  issuer: ISSUER,
  clientId: 'xstockstrat-staging-web',
  mcpClientIds: { claude: '', claudeReadonly: '', claudeCode: '', claudeCodeReadonly: '' },
  valid: true,
};

const link = (userId = TEST_USER_ID) =>
  sealSsoLink({
    link_id: 'l-1',
    iss: ISSUER,
    sub: 'sso-subject-1',
    label: 'sso@example.test',
    user_id: userId,
    exp: NOW_S + 600,
  });

async function get(opts: { token?: string | null; linkCookie?: string } = {}): Promise<Response> {
  const token = opts.token === undefined ? await signTestJwt(['trader']) : opts.token;
  const cookies = [
    token ? `access_token=${token}` : '',
    opts.linkCookie ? `sso_link=${opts.linkCookie}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return GET(
    new NextRequest(`${APP}/accounts/api/sso`, { headers: cookies ? { cookie: cookies } : {} }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_S * 1000);
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('APP_URL', APP);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const m of [loadAuthMode, loadOidcConfig, getExternalIdentityLinks]) m.mockReset();
  loadAuthMode.mockResolvedValue('both');
  loadOidcConfig.mockResolvedValue(CFG);
  getExternalIdentityLinks.mockResolvedValue({ issuers: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('@AC-77 handler rows', () => {
  test('FR-16.6 a stale session token → 401 unauthorized', async () => {
    const res = await get({ token: 'not-a-jwt' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(getExternalIdentityLinks).not.toHaveBeenCalled();
  });

  test('row 2: GetExternalIdentityLinks fails → 503 failed', async () => {
    getExternalIdentityLinks.mockRejectedValue(new ConnectError('down', Code.Unavailable));
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'failed' });
  });

  test('row 3: config unreadable → 200 mode error, no Link action', async () => {
    loadAuthMode.mockResolvedValue('error');
    loadOidcConfig.mockResolvedValue('error');
    getExternalIdentityLinks.mockResolvedValue({ issuers: [ISSUER] });
    const res = await get({ linkCookie: await link() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: 'error',
      linked: true,
      canLink: false,
      pending: null,
    });
  });
});

describe('linked per D-134', () => {
  test.each([
    ['valid issuer in issuers', CFG, [ISSUER], true],
    ['valid issuer, a different link only', CFG, [OTHER_ISSUER], false],
    ['valid issuer, no link', CFG, [], false],
    [
      'invalid issuer → any link',
      { ...CFG, issuer: 'http://x', valid: false },
      [OTHER_ISSUER],
      true,
    ],
    ['invalid issuer, no link', { ...CFG, issuer: '', valid: false }, [], false],
    ['ui fault → any link', 'error', [OTHER_ISSUER], true],
  ])('%s', async (_, cfg, issuers, linked) => {
    loadOidcConfig.mockResolvedValue(cfg);
    getExternalIdentityLinks.mockResolvedValue({ issuers });
    expect((await (await get()).json()).linked).toBe(linked);
  });
});

test('GetLinks is called for the session user with the session headers', async () => {
  await get();
  const [req, opts] = getExternalIdentityLinks.mock.calls[0];
  expect(req).toEqual({ userId: TEST_USER_ID });
  expect(opts.timeoutMs).toBe(10_000);
  expect((opts.headers as Headers).get(HEADER_USER_ID)).toBe(TEST_USER_ID);
});

describe('canLink and pending', () => {
  test('@AC-67 canLink is true in both even when already linked', async () => {
    getExternalIdentityLinks.mockResolvedValue({ issuers: [ISSUER] });
    expect(await (await get()).json()).toEqual({
      mode: 'both',
      linked: true,
      canLink: true,
      pending: null,
    });
  });

  test.each(['local', 'oidc'])('@AC-69 %s → canLink false, no pending', async (mode) => {
    loadAuthMode.mockResolvedValue(mode);
    expect(await (await get({ linkCookie: await link() })).json()).toEqual({
      mode,
      linked: false,
      canLink: false,
      pending: null,
    });
  });

  test('pending for a sso_link of the session user; the body never carries iss or sub', async () => {
    const res = await get({ linkCookie: await link() });
    const body = await res.json();
    expect(body.pending).toEqual({
      linkId: 'l-1',
      label: 'sso@example.test',
      accountEmail: TEST_USER_EMAIL,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(ISSUER);
    expect(text).not.toContain('sso-subject-1');
  });

  test('no pending for a sso_link of another user, or an expired one', async () => {
    expect(
      (await (await get({ linkCookie: await link(TEST_USER_B_ID) })).json()).pending,
    ).toBeNull();
    const cookie = await link();
    vi.setSystemTime((NOW_S + 601) * 1000);
    expect((await (await get({ linkCookie: cookie })).json()).pending).toBeNull();
  });

  test('the second user sees their own pending link', async () => {
    const token = await signTestJwt(['trader'], { id: TEST_USER_B_ID, email: TEST_USER_B_EMAIL });
    const body = await (await get({ token, linkCookie: await link(TEST_USER_B_ID) })).json();
    expect(body.pending.accountEmail).toBe(TEST_USER_B_EMAIL);
  });
});
