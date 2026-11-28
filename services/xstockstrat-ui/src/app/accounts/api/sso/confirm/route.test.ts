// C-12: user ids from e2e/fixtures/users.ts, session JWTs from e2e/helpers/auth.ts; issuer, link
// ids, passwords and Connect errors are scenario one-offs.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';
import { signTestJwt, TEST_JWT_SECRET } from '../../../../../../e2e/helpers/auth';
import { TEST_USER_B_ID, TEST_USER_ID } from '../../../../../../e2e/fixtures/users';
import { HEADER_USER_ID } from '@/lib/headers';
import { sealSsoLink } from '@/lib/ssoTxn';

const { loadAuthMode, linkExternalIdentity, recordAuthEvent } = vi.hoisted(() => ({
  loadAuthMode: vi.fn(),
  linkExternalIdentity: vi.fn(),
  recordAuthEvent: vi.fn(),
}));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode }));
vi.mock('@/lib/connectClients', () => ({ identityClient: { linkExternalIdentity } }));
vi.mock('@/lib/bffMetrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bffMetrics')>()),
  recordAuthEvent,
}));

const { POST } = await import('./route');

const APP = 'http://localhost:3000';
const ISSUER = 'https://auth.example.test';
const SIBLING = 'https://dashboard.example.test';
const SUBJECT = 'sso-subject-1';
const NOW_S = 1_800_000_000;
const LINK_ID = 'l-1';

const sealed = (over: { user_id?: string; exp?: number } = {}) =>
  sealSsoLink({
    link_id: LINK_ID,
    iss: ISSUER,
    sub: SUBJECT,
    label: 'sso@example.test',
    user_id: over.user_id ?? TEST_USER_ID,
    exp: over.exp ?? NOW_S + 600,
  });

async function confirm(
  opts: {
    token?: string;
    origin?: string | null;
    linkCookie?: string | null;
    body?: Record<string, unknown>;
  } = {},
): Promise<Response> {
  const token = opts.token ?? (await signTestJwt(['trader']));
  const linkCookie = opts.linkCookie === undefined ? await sealed() : opts.linkCookie;
  const headers: Record<string, string> = {
    cookie: [`access_token=${token}`, linkCookie ? `sso_link=${linkCookie}` : '']
      .filter(Boolean)
      .join('; '),
    'content-type': 'application/json',
  };
  const origin = opts.origin === undefined ? APP : opts.origin;
  if (origin !== null) headers.origin = origin;
  return POST(
    new NextRequest(`${APP}/accounts/api/sso/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body ?? { linkId: LINK_ID, password: 'pw' }),
    }),
  );
}

const linkCleared = (res: Response) =>
  res.headers.getSetCookie().some((c) => c.startsWith('sso_link=') && c.includes('Max-Age=0'));
const expectError = async (res: Response, status: number, error: string) => {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_S * 1000);
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  vi.stubEnv('APP_URL', APP);
  for (const f of ['warn', 'error', 'info', 'log'] as const) {
    vi.spyOn(console, f).mockImplementation(() => {});
  }
  for (const m of [loadAuthMode, linkExternalIdentity, recordAuthEvent]) m.mockReset();
  loadAuthMode.mockResolvedValue('both');
  linkExternalIdentity.mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('@AC-77 handler rows', () => {
  test('FR-16.6 a stale session token → 401', async () => {
    await expectError(await confirm({ token: 'not-a-jwt' }), 401, 'unauthorized');
    expect(linkExternalIdentity).not.toHaveBeenCalled();
  });

  test('row 8: config unreadable → 503 failed', async () => {
    loadAuthMode.mockResolvedValue('error');
    await expectError(await confirm(), 503, 'failed');
    expect(linkExternalIdentity).not.toHaveBeenCalled();
  });
});

test.each(['local', 'oidc'])('%s → 404 not_found', async (mode) => {
  loadAuthMode.mockResolvedValue(mode);
  await expectError(await confirm(), 404, 'not_found');
});

test.each([
  ['sibling', SIBLING],
  ['missing', null],
])('a %s Origin → 403 failed, identity not called', async (_, origin) => {
  await expectError(await confirm({ origin }), 403, 'failed');
  expect(linkExternalIdentity).not.toHaveBeenCalled();
});

describe('@AC-65 OK', () => {
  test('200 {ok:true}, the cookie cleared, the session user and headers sent', async () => {
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(linkCleared(res)).toBe(true);
    const [req, opts] = linkExternalIdentity.mock.calls[0];
    expect(req).toEqual({ userId: TEST_USER_ID, issuer: ISSUER, subject: SUBJECT, password: 'pw' });
    expect(opts.timeoutMs).toBe(10_000);
    expect((opts.headers as Headers).get(HEADER_USER_ID)).toBe(TEST_USER_ID);
    expect(recordAuthEvent).not.toHaveBeenCalled();
  });
});

describe('refusals map to 400 codes', () => {
  test.each([
    ['@AC-66', 'invalid credentials', 'invalid_credentials', false],
    ['inactive', 'account inactive', 'inactive', true],
    ['@AC-4', 'account already linked', 'already_linked_other', true],
    ['@AC-67', 'already linked to this issuer', 'already_linked_self', true],
    ['link disabled', 'link disabled', 'failed', true],
  ])('%s %s → 400 %s', async (_, detail, code, cleared) => {
    linkExternalIdentity.mockRejectedValue(new ConnectError(detail, Code.FailedPrecondition));
    const res = await confirm();
    await expectError(res, 400, code);
    expect(linkCleared(res)).toBe(cleared);
    expect(recordAuthEvent.mock.calls).toEqual([['sso_link_failed', code]]);
  });

  test('an unknown FailedPrecondition detail → 503 failed, cookie kept', async () => {
    linkExternalIdentity.mockRejectedValue(new ConnectError('surprise', Code.FailedPrecondition));
    const res = await confirm();
    await expectError(res, 503, 'failed');
    expect(linkCleared(res)).toBe(false);
  });

  test.each([Code.Unavailable, Code.DeadlineExceeded, Code.Internal])(
    'code %s → 503 failed, cookie kept',
    async (code) => {
      linkExternalIdentity.mockRejectedValue(new ConnectError('x', code));
      const res = await confirm();
      await expectError(res, 503, 'failed');
      expect(linkCleared(res)).toBe(false);
    },
  );

  test('no response is ever 401 after the session check', async () => {
    linkExternalIdentity.mockRejectedValue(new ConnectError('x', Code.Unauthenticated));
    expect((await confirm()).status).toBe(503);
  });
});

describe('@AC-68 the sso_link must belong to the session and this linkId', () => {
  test.each([
    ['missing', null],
    ['undecryptable', 'garbage'],
  ])('%s → 400 failed, identity not called', async (_, linkCookie) => {
    const res = await confirm({ linkCookie });
    await expectError(res, 400, 'failed');
    expect(linkCleared(res)).toBe(true);
    expect(linkExternalIdentity).not.toHaveBeenCalled();
  });

  test('another user_id → 400 failed', async () => {
    const res = await confirm({ linkCookie: await sealed({ user_id: TEST_USER_B_ID }) });
    await expectError(res, 400, 'failed');
    expect(linkExternalIdentity).not.toHaveBeenCalled();
  });

  test('expired → 400 failed', async () => {
    const linkCookie = await sealed();
    vi.setSystemTime((NOW_S + 601) * 1000);
    const token = await signTestJwt(['trader']);
    await expectError(await confirm({ token, linkCookie }), 400, 'failed');
    expect(linkExternalIdentity).not.toHaveBeenCalled();
  });

  test('a different linkId → 400 failed', async () => {
    const res = await confirm({ body: { linkId: 'l-2', password: 'pw' } });
    await expectError(res, 400, 'failed');
    expect(linkExternalIdentity).not.toHaveBeenCalled();
  });
});

test('an empty password → 400 invalid_credentials, identity not called', async () => {
  const res = await confirm({ body: { linkId: LINK_ID, password: '' } });
  await expectError(res, 400, 'invalid_credentials');
  expect(linkExternalIdentity).not.toHaveBeenCalled();
});

test('the password never reaches a log argument', async () => {
  linkExternalIdentity.mockRejectedValue(new ConnectError('x', Code.Unavailable));
  await confirm({ body: { linkId: LINK_ID, password: 'PW-SENTINEL' } });
  const text = JSON.stringify(
    [console.warn, console.error, console.info, console.log].flatMap((f) =>
      vi.mocked(f).mock.calls.flat(),
    ),
  );
  expect(text).not.toContain('PW-SENTINEL');
});
