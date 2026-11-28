// C-12: user ids from e2e/fixtures/users.ts, the JWT secret from e2e/helpers/auth.ts; issuer,
// claims, sentinels and Connect errors are scenario one-offs.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';
import { TEST_JWT_SECRET } from '../../../../../../e2e/helpers/auth';
import { TEST_USER_ID } from '../../../../../../e2e/fixtures/users';
import { HEADER_TRACE_ID } from '@/lib/headers';
import { openSsoLink, sealSsoTxn, txnCookieName } from '@/lib/ssoTxn';

const {
  loadAuthMode,
  loadOidcConfig,
  loadOidcClientSecret,
  getOidcConfiguration,
  exchangeCode,
  resolveExternalIdentity,
  issueSessionForUser,
  recordAuthEvent,
} = vi.hoisted(() => ({
  loadAuthMode: vi.fn(),
  loadOidcConfig: vi.fn(),
  loadOidcClientSecret: vi.fn(),
  getOidcConfiguration: vi.fn(),
  exchangeCode: vi.fn(),
  resolveExternalIdentity: vi.fn(),
  issueSessionForUser: vi.fn(),
  recordAuthEvent: vi.fn(),
}));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode, loadOidcConfig, loadOidcClientSecret }));
vi.mock('@/lib/oidcClient', () => ({ getOidcConfiguration, exchangeCode }));
vi.mock('@/lib/connectClients', () => ({
  identityClient: { resolveExternalIdentity, issueSessionForUser },
}));
vi.mock('@/lib/bffMetrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bffMetrics')>()),
  recordAuthEvent,
}));

const { GET } = await import('./route');

const APP = 'http://localhost:3000';
const ISSUER = 'https://auth.example.test';
const SUBJECT = 'sso-subject-1';
const STATE = 's-1';
const NOW_S = 1_800_000_000;
const CFG = {
  issuer: ISSUER,
  clientId: 'xstockstrat-staging-web',
  mcpClientIds: { claude: '', claudeReadonly: '', claudeCode: '', claudeCodeReadonly: '' },
  valid: true,
};
const OIDC_CFG = { tag: 'configuration' };

const loginTxn = (over: { remember?: boolean; redirect?: string } = {}) =>
  sealSsoTxn({
    purpose: 'login',
    state: STATE,
    nonce: 'n-1',
    code_verifier: 'v-1',
    remember: over.remember ?? false,
    redirect: over.redirect ?? '/trader',
  });
const SESSION_HASH = 'a'.repeat(64);
const linkTxn = () =>
  sealSsoTxn({
    purpose: 'link',
    state: STATE,
    nonce: 'n-1',
    code_verifier: 'v-1',
    user_id: TEST_USER_ID,
    session_hash: SESSION_HASH,
  });

type Call = {
  query?: Record<string, string>;
  txn?: string;
  extraCookies?: string[];
  traceId?: string;
};

function callback({ query, txn, extraCookies = [], traceId }: Call = {}): Promise<Response> {
  const q = new URLSearchParams(query ?? { code: 'CODE-SENTINEL', state: STATE });
  const cookies = [...(txn ? [`${txnCookieName(STATE)}=${txn}`] : []), ...extraCookies];
  const headers: Record<string, string> = {};
  if (cookies.length) headers.cookie = cookies.join('; ');
  if (traceId) headers[HEADER_TRACE_ID] = traceId;
  return GET(new NextRequest(`${APP}/api/auth/sso/callback?${q}`, { headers }));
}

const location = (res: Response) => res.headers.get('location');
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieNamed = (res: Response, name: string) =>
  setCookies(res).find((c) => c.startsWith(`${name}=`));
const clearedNames = (res: Response) =>
  setCookies(res)
    .filter((c) => c.includes('Max-Age=0'))
    .map((c) => c.split('=')[0]);
const sessionSet = (res: Response) =>
  setCookies(res).some((c) => c.startsWith('access_token=') && !c.includes('Max-Age=0'));
const linkCookieValue = (res: Response) =>
  cookieNamed(res, 'sso_link')?.slice('sso_link='.length).split(';')[0];
const allLogArgs = () =>
  [console.warn, console.error, console.info, console.log].flatMap((f) =>
    vi.mocked(f).mock.calls.flat(),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_S * 1000);
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('APP_URL', APP);
  for (const f of ['warn', 'error', 'info', 'log'] as const) {
    vi.spyOn(console, f).mockImplementation(() => {});
  }
  for (const m of [
    loadAuthMode,
    loadOidcConfig,
    loadOidcClientSecret,
    getOidcConfiguration,
    exchangeCode,
    resolveExternalIdentity,
    issueSessionForUser,
    recordAuthEvent,
  ]) {
    m.mockReset();
  }
  loadAuthMode.mockResolvedValue('oidc');
  loadOidcConfig.mockResolvedValue(CFG);
  loadOidcClientSecret.mockResolvedValue({ found: true, value: 'secret' });
  getOidcConfiguration.mockResolvedValue(OIDC_CFG);
  exchangeCode.mockResolvedValue({ iss: ISSUER, sub: SUBJECT, email: 'sentinel@example.test' });
  resolveExternalIdentity.mockResolvedValue({ userId: TEST_USER_ID, roles: [], isActive: true });
  issueSessionForUser.mockResolvedValue({ accessToken: 'at-new', refreshToken: 'rt-new' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('mode and config', () => {
  test('@AC-47 local → 404, Resolve not called', async () => {
    loadAuthMode.mockResolvedValue('local');
    const res = await callback({ txn: await loginTxn() });
    expect(res.status).toBe(404);
    expect(location(res)).toBeNull();
    expect(resolveExternalIdentity).not.toHaveBeenCalled();
  });

  test('@AC-60 mode unreadable → login failed as a fault', async () => {
    loadAuthMode.mockResolvedValue('error');
    const res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
    expect(recordAuthEvent.mock.calls).toEqual([['sso_login_error']]);
  });

  test('ui config unreadable → failed; invalid → not_configured', async () => {
    loadOidcConfig.mockResolvedValue('error');
    expect(location(await callback({ txn: await loginTxn() }))).toBe(
      `${APP}/auth/login?error=failed`,
    );
    loadOidcConfig.mockResolvedValue({ ...CFG, valid: false });
    expect(location(await callback({ txn: await loginTxn() }))).toBe(
      `${APP}/auth/login?error=not_configured`,
    );
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});

describe('IdP error parameter', () => {
  test('@AC-51 access_denied with a login txn → login no_access, txn cleared', async () => {
    const res = await callback({
      query: { error: 'access_denied', state: STATE },
      txn: await loginTxn(),
    });
    expect(location(res)).toBe(`${APP}/auth/login?error=no_access`);
    expect(clearedNames(res)).toContain(txnCookieName(STATE));
    expect(recordAuthEvent.mock.calls).toEqual([['sso_login_failed', 'no_access']]);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  test('@AC-76 access_denied with a link txn → /accounts/sso no_access, no sso_login_failed', async () => {
    loadAuthMode.mockResolvedValue('both');
    const res = await callback({
      query: { error: 'access_denied', state: STATE },
      txn: await linkTxn(),
    });
    expect(location(res)).toBe(`${APP}/accounts/sso?error=no_access`);
    expect(clearedNames(res)).toContain(txnCookieName(STATE));
    expect(recordAuthEvent.mock.calls).toEqual([['sso_link_failed', 'no_access']]);
  });

  test('server_error with a link txn → link failed', async () => {
    loadAuthMode.mockResolvedValue('both');
    const res = await callback({
      query: { error: 'server_error', state: STATE },
      txn: await linkTxn(),
    });
    expect(location(res)).toBe(`${APP}/accounts/sso?error=failed`);
  });

  test('an expired link txn → the login page', async () => {
    loadAuthMode.mockResolvedValue('both');
    const txn = await linkTxn();
    vi.setSystemTime((NOW_S + 601) * 1000);
    const res = await callback({ query: { error: 'access_denied', state: STATE }, txn });
    expect(location(res)).toBe(`${APP}/auth/login?error=no_access`);
  });
});

describe('@AC-24 transaction and token validation', () => {
  test('state s-999 has no txn → failed, no exchange, no Resolve', async () => {
    const res = await callback({
      query: { code: 'CODE-SENTINEL', state: 's-999' },
      txn: await loginTxn(),
    });
    expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(resolveExternalIdentity).not.toHaveBeenCalled();
    expect(sessionSet(res)).toBe(false);
  });

  test.each([
    'unexpected ID Token "nonce" claim value',
    'unexpected JWT "aud" (audience) claim value',
  ])(
    'exchangeCode rejects (%s) → failed, Resolve never called, no session cookie',
    async (message) => {
      exchangeCode.mockRejectedValue(new Error(`${message} IDTOKEN-SENTINEL`));
      const res = await callback({ txn: await loginTxn() });
      expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
      expect(resolveExternalIdentity).not.toHaveBeenCalled();
      expect(sessionSet(res)).toBe(false);
      expect(vi.mocked(console.warn).mock.calls).toContainEqual([
        'sso_callback_failed',
        { error_class: 'Error' },
      ]);
    },
  );

  test('the exchange gets the checks from the txn and a callback URL on APP_URL', async () => {
    await callback({ txn: await loginTxn() });
    expect(getOidcConfiguration).toHaveBeenCalledWith(ISSUER, CFG.clientId, 'secret');
    const [cfg, url, checks] = exchangeCode.mock.calls[0];
    expect(cfg).toBe(OIDC_CFG);
    expect((url as URL).href).toBe(
      `${APP}/api/auth/sso/callback?code=CODE-SENTINEL&state=${STATE}`,
    );
    expect(checks).toEqual({
      pkceCodeVerifier: 'v-1',
      expectedState: STATE,
      expectedNonce: 'n-1',
    });
  });

  test('secret unset → not_configured; secret fault → failed', async () => {
    loadOidcClientSecret.mockResolvedValue({ found: false });
    expect(location(await callback({ txn: await loginTxn() }))).toBe(
      `${APP}/auth/login?error=not_configured`,
    );
    loadOidcClientSecret.mockResolvedValue('error');
    expect(location(await callback({ txn: await loginTxn() }))).toBe(
      `${APP}/auth/login?error=failed`,
    );
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});

describe('login purpose', () => {
  test('@AC-1 Resolve OK → IssueSession → session cookies, 303 to /trader', async () => {
    const res = await callback({ txn: await loginTxn() });
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`${APP}/trader`);
    expect(issueSessionForUser.mock.calls[0][0]).toEqual({ userId: TEST_USER_ID });
    expect(cookieNamed(res, 'access_token')).toMatch(/^access_token=at-new;/);
    expect(cookieNamed(res, 'refresh_token')).toMatch(/^refresh_token=rt-new;/);
    expect(recordAuthEvent.mock.calls).toEqual([['sso_login_ok']]);
  });

  test('@AC-2 the Resolve request is exactly {issuer, subject}', async () => {
    await callback({ txn: await loginTxn() });
    expect(resolveExternalIdentity.mock.calls[0][0]).toEqual({ issuer: ISSUER, subject: SUBJECT });
  });

  test('a stored redirect is kept; an off-site one falls back to /trader', async () => {
    expect(location(await callback({ txn: await loginTxn({ redirect: '/insights/x' }) }))).toBe(
      `${APP}/insights/x`,
    );
    expect(
      location(await callback({ txn: await loginTxn({ redirect: 'https://evil.example.test' }) })),
    ).toBe(`${APP}/trader`);
  });

  describe('@AC-3 not linked → not_linked', () => {
    test.each(['both', 'oidc'])('%s', async (mode) => {
      loadAuthMode.mockResolvedValue(mode);
      resolveExternalIdentity.mockRejectedValue(
        new ConnectError('not linked', Code.FailedPrecondition),
      );
      const res = await callback({ txn: await loginTxn() });
      expect(location(res)).toBe(`${APP}/auth/login?error=not_linked`);
      expect(issueSessionForUser).not.toHaveBeenCalled();
      expect(sessionSet(res)).toBe(false);
    });
  });

  test('@AC-6 the same refusal under APPLICATION_ENV=production', async () => {
    vi.stubEnv('APPLICATION_ENV', 'production');
    resolveExternalIdentity.mockRejectedValue(
      new ConnectError('not linked', Code.FailedPrecondition),
    );
    const res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=not_linked`);
  });

  test('@AC-7 account inactive (Resolve or IssueSession) → inactive, no cookies', async () => {
    resolveExternalIdentity.mockRejectedValue(
      new ConnectError('account inactive', Code.FailedPrecondition),
    );
    let res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=inactive`);
    expect(sessionSet(res)).toBe(false);

    resolveExternalIdentity.mockResolvedValue({ userId: TEST_USER_ID, roles: [], isActive: true });
    issueSessionForUser.mockRejectedValue(
      new ConnectError('account inactive', Code.FailedPrecondition),
    );
    res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=inactive`);
    expect(sessionSet(res)).toBe(false);
  });

  test('370 IssueSession "sso disabled" (mode-change window) → failed, not inactive', async () => {
    issueSessionForUser.mockRejectedValue(
      new ConnectError('sso disabled', Code.FailedPrecondition),
    );
    const res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
    expect(sessionSet(res)).toBe(false);
  });

  test('any other identity error → failed, no cookies', async () => {
    resolveExternalIdentity.mockRejectedValue(new ConnectError('down', Code.Unavailable));
    let res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
    resolveExternalIdentity.mockResolvedValue({ userId: TEST_USER_ID, roles: [], isActive: true });
    issueSessionForUser.mockRejectedValue(new ConnectError('down', Code.Unavailable));
    res = await callback({ txn: await loginTxn() });
    expect(location(res)).toBe(`${APP}/auth/login?error=failed`);
    expect(sessionSet(res)).toBe(false);
  });

  test('@AC-29 remember → Max-Age=1209600 + remember_me=1; every sso_txn_* cleared', async () => {
    const other = 'sso_txn_0123456789abcdef=stale';
    const res = await callback({ txn: await loginTxn({ remember: true }), extraCookies: [other] });
    expect(cookieNamed(res, 'access_token')).toContain('Max-Age=1209600');
    expect(cookieNamed(res, 'refresh_token')).toContain('Max-Age=1209600');
    expect(cookieNamed(res, 'remember_me')).toMatch(/^remember_me=1;.*Max-Age=1209600/);
    expect(clearedNames(res).sort()).toEqual(
      [txnCookieName(STATE), 'sso_txn_0123456789abcdef'].sort(),
    );
  });

  test('@AC-29 without remember → session cookies', async () => {
    const res = await callback({ txn: await loginTxn() });
    expect(cookieNamed(res, 'access_token')).not.toContain('Max-Age');
    expect(cookieNamed(res, 'remember_me')).toContain('Max-Age=0');
  });

  test('one trace per login: an inbound x-trace-id reaches both RPCs', async () => {
    await callback({ txn: await loginTxn(), traceId: 't-in' });
    expect(resolveExternalIdentity.mock.calls[0][1]).toEqual({
      timeoutMs: 10_000,
      headers: { [HEADER_TRACE_ID]: 't-in' },
    });
    expect(issueSessionForUser.mock.calls[0][1]).toEqual({
      timeoutMs: 10_000,
      headers: { [HEADER_TRACE_ID]: 't-in' },
    });
  });

  test('without an inbound trace both RPCs get the same generated id', async () => {
    await callback({ txn: await loginTxn() });
    const a = resolveExternalIdentity.mock.calls[0][1].headers[HEADER_TRACE_ID];
    const b = issueSessionForUser.mock.calls[0][1].headers[HEADER_TRACE_ID];
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toBe(a);
  });
});

describe('link purpose', () => {
  beforeEach(() => {
    loadAuthMode.mockResolvedValue('both');
  });

  test.each([
    [{ email: 'sso@example.test', preferred_username: 'sso-user' }, 'sso@example.test'],
    [{ preferred_username: 'sso-user' }, 'sso-user'],
    [{}, 'your single sign-on account'],
  ])(
    '@AC-65 fresh auth_time → sso_link sealed (label %o), no identity call',
    async (extra, label) => {
      exchangeCode.mockResolvedValue({ iss: ISSUER, sub: SUBJECT, auth_time: NOW_S, ...extra });
      const res = await callback({ txn: await linkTxn() });
      expect(res.status).toBe(303);
      expect(location(res)).toBe(`${APP}/accounts/sso`);
      expect(resolveExternalIdentity).not.toHaveBeenCalled();
      expect(issueSessionForUser).not.toHaveBeenCalled();
      expect(sessionSet(res)).toBe(false);
      const link = await openSsoLink(linkCookieValue(res)!);
      expect(link).toMatchObject({
        iss: ISSUER,
        sub: SUBJECT,
        label,
        user_id: TEST_USER_ID,
        exp: NOW_S + 600,
        session_hash: SESSION_HASH,
      });
      expect(link!.link_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(clearedNames(res)).toContain(txnCookieName(STATE));
    },
  );

  test('@AC-65 mode oidc on a link txn → link failed', async () => {
    loadAuthMode.mockResolvedValue('oidc');
    exchangeCode.mockResolvedValue({ iss: ISSUER, sub: SUBJECT, auth_time: NOW_S });
    const res = await callback({ txn: await linkTxn() });
    expect(location(res)).toBe(`${APP}/accounts/sso?error=failed`);
    expect(linkCookieValue(res)).toBeUndefined();
  });

  test.each([
    ['absent', undefined, 'auth_time_missing'],
    ['created_at − 31 s', NOW_S - 31, 'auth_time_stale'],
  ])('@AC-74 auth_time %s → link failed + WARN, no sso_link', async (_, authTime, reason) => {
    exchangeCode.mockResolvedValue({
      iss: ISSUER,
      sub: SUBJECT,
      ...(authTime === undefined ? {} : { auth_time: authTime }),
    });
    const res = await callback({ txn: await linkTxn() });
    expect(location(res)).toBe(`${APP}/accounts/sso?error=failed`);
    expect(vi.mocked(console.warn).mock.calls).toContainEqual(['sso_link_refused', { reason }]);
    expect(linkCookieValue(res)).toBeUndefined();
    expect(recordAuthEvent.mock.calls).toEqual([['sso_link_failed', 'failed']]);
  });

  test('@AC-74 created_at − 30 s is accepted', async () => {
    exchangeCode.mockResolvedValue({ iss: ISSUER, sub: SUBJECT, auth_time: NOW_S - 30 });
    const res = await callback({ txn: await linkTxn() });
    expect(location(res)).toBe(`${APP}/accounts/sso`);
    expect(linkCookieValue(res)).toBeTruthy();
  });

  test('a failed exchange on a link txn → link failed', async () => {
    exchangeCode.mockRejectedValue(new Error('bad'));
    const res = await callback({ txn: await linkTxn() });
    expect(location(res)).toBe(`${APP}/accounts/sso?error=failed`);
  });
});

test('D-75 sentinels never reach a log argument', async () => {
  exchangeCode.mockRejectedValue(new Error('IDTOKEN-SENTINEL sentinel@example.test'));
  await callback({ txn: await loginTxn() });
  exchangeCode.mockResolvedValue({ iss: ISSUER, sub: SUBJECT, email: 'sentinel@example.test' });
  resolveExternalIdentity.mockRejectedValue(
    new ConnectError('not linked', Code.FailedPrecondition),
  );
  await callback({ txn: await loginTxn() });
  loadAuthMode.mockResolvedValue('both');
  exchangeCode.mockResolvedValue({ iss: ISSUER, sub: SUBJECT, email: 'sentinel@example.test' });
  await callback({ txn: await linkTxn() });
  const text = JSON.stringify(allLogArgs());
  for (const s of ['CODE-SENTINEL', 'IDTOKEN-SENTINEL', 'sentinel@example.test', SUBJECT]) {
    expect(text).not.toContain(s);
  }
});
