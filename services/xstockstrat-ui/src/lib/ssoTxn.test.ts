// C-12: session-secret signing comes from e2e/helpers/auth.ts; txn values are scenario one-offs.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { signTestJwt, TEST_JWT_SECRET } from '../../e2e/helpers/auth';
import {
  clearAllTxnCookies,
  clearSsoLink,
  openSsoLink,
  openSsoTxn,
  sealSsoLink,
  sealSsoTxn,
  SSO_LINK_COOKIE,
  ssoLinkCookieOpts,
  TXN_COOKIE_OPTS,
  txnCookieName,
} from './ssoTxn';

const T0 = new Date('2026-11-27T12:00:00Z');
const nowS = () => Math.floor(Date.now() / 1000);

const LOGIN = {
  purpose: 'login' as const,
  state: 's-1',
  nonce: 'n-1',
  code_verifier: 'v-1',
  remember: true,
  redirect: '/trader',
};
const LINK = {
  purpose: 'link' as const,
  state: 's-2',
  nonce: 'n-2',
  code_verifier: 'v-2',
  user_id: 'user-1',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the transaction cookie', () => {
  test('a login txn round-trips with exp = now + 600', async () => {
    const opened = await openSsoTxn(await sealSsoTxn(LOGIN));
    expect(opened).toEqual({ ...LOGIN, exp: nowS() + 600 });
  });

  test('a link txn round-trips with created_at = now', async () => {
    const opened = await openSsoTxn(await sealSsoTxn(LINK));
    expect(opened).toEqual({ ...LINK, created_at: nowS(), exp: nowS() + 600 });
  });

  test('a tampered JWE → null', async () => {
    const jwe = await sealSsoTxn(LOGIN);
    const parts = jwe.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    expect(await openSsoTxn(parts.join('.'))).toBeNull();
  });

  test('@AC-76 an expired txn → null (+601 s)', async () => {
    const jwe = await sealSsoTxn(LINK);
    vi.setSystemTime(T0.getTime() + 601_000);
    expect(await openSsoTxn(jwe)).toBeNull();
  });

  test('another JWT_SECRET cannot open it', async () => {
    const jwe = await sealSsoTxn(LOGIN);
    vi.stubEnv('JWT_SECRET', `${TEST_JWT_SECRET}-rotated`);
    expect(await openSsoTxn(jwe)).toBeNull();
  });

  test('an HS256 JWS signed with JWT_SECRET is not accepted (R-7)', async () => {
    const jws = await signTestJwt(['admin']);
    expect(await openSsoTxn(jws)).toBeNull();
    expect(await openSsoLink(jws)).toBeNull();
  });

  test('the cookie name derives from sha256(state)', () => {
    const digest = createHash('sha256').update('s-1').digest('hex');
    expect(txnCookieName('s-1')).toBe(`sso_txn_${digest.slice(0, 16)}`);
  });

  test('the options are httpOnly, Lax, scoped to the callback path, 600 s', () => {
    expect(TXN_COOKIE_OPTS).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/api/auth/sso/callback',
      maxAge: 600,
    });
  });

  test('the options carry secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const fresh = await import('./ssoTxn');
    expect(fresh.TXN_COOKIE_OPTS.secure).toBe(true);
    expect(fresh.ssoLinkCookieOpts(nowS() + 60).secure).toBe(true);
  });

  test('clearAllTxnCookies expires every sso_txn_* cookie on the callback path', () => {
    const req = new NextRequest('https://x.test/api/auth/sso/callback', {
      headers: { cookie: 'sso_txn_aaaa=1; sso_txn_bbbb=2; access_token=t' },
    });
    const res = NextResponse.json({});
    clearAllTxnCookies(req, res);
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(2);
    for (const name of ['sso_txn_aaaa', 'sso_txn_bbbb']) {
      const c = res.cookies.get(name)!;
      expect(c).toMatchObject({ value: '', maxAge: 0, path: '/api/auth/sso/callback' });
    }
    expect(res.cookies.get('access_token')).toBeUndefined();
  });
});

describe('the link cookie', () => {
  const LINK_COOKIE = {
    link_id: 'l-1',
    iss: 'https://auth.example.test',
    sub: 'authelia-sub-1',
    label: 'trader@example.test',
    user_id: 'user-1',
  };

  test('round-trips with the given absolute exp', async () => {
    const exp = nowS() + 600;
    expect(await openSsoLink(await sealSsoLink({ ...LINK_COOKIE, exp }))).toEqual({
      ...LINK_COOKIE,
      exp,
    });
    expect(SSO_LINK_COOKIE).toBe('sso_link');
  });

  test('a txn-sealed JWE does not open as a link cookie (separate keys)', async () => {
    expect(await openSsoLink(await sealSsoTxn(LINK))).toBeNull();
  });

  test("@AC-68 sso_link carries the txn's absolute exp: +601 s from the link start → null", async () => {
    const txn = (await openSsoTxn(await sealSsoTxn(LINK)))!;
    vi.setSystemTime(T0.getTime() + 300_000);
    const jwe = await sealSsoLink({ ...LINK_COOKIE, exp: txn.exp });
    expect(await openSsoLink(jwe)).not.toBeNull();
    vi.setSystemTime(T0.getTime() + 601_000);
    expect(await openSsoLink(jwe)).toBeNull();
  });

  test('@AC-68 its maxAge shrinks with elapsed time and never goes negative', () => {
    const exp = nowS() + 600;
    expect(ssoLinkCookieOpts(exp)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 600,
    });
    vi.setSystemTime(T0.getTime() + 450_000);
    expect(ssoLinkCookieOpts(exp).maxAge).toBe(150);
    vi.setSystemTime(T0.getTime() + 700_000);
    expect(ssoLinkCookieOpts(exp).maxAge).toBe(0);
  });

  test('clearSsoLink expires the cookie on /', () => {
    const res = NextResponse.json({});
    clearSsoLink(res);
    expect(res.cookies.get('sso_link')).toMatchObject({ value: '', maxAge: 0, path: '/' });
  });
});
