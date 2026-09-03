import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setSessionCookies,
  clearSessionCookies,
  rememberMeOptsFromRequest,
  REMEMBER_ME_COOKIE,
  REMEMBER_ME_MAX_AGE_SECONDS,
} from './auth';
import type { NextResponse } from 'next/server';

/** Minimal NextResponse stand-in that records cookie writes (feature 153). */
function fakeResponse() {
  const calls: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];
  const res = {
    cookies: {
      set: (name: string, value: string, opts: Record<string, unknown>) =>
        calls.push({ name, value, opts }),
    },
  };
  return { res: res as unknown as NextResponse, calls };
}

const byName = (calls: ReturnType<typeof fakeResponse>['calls'], name: string) =>
  calls.find((c) => c.name === name);

describe('setSessionCookies — extended session (feature 153)', () => {
  it('writes session cookies (no maxAge) by default and wipes any stale remember-me marker', () => {
    const { res, calls } = fakeResponse();
    setSessionCookies(res, 'access', 'refresh');
    // access + refresh are session cookies (no maxAge); the marker is explicitly cleared.
    expect(calls.map((c) => c.name)).toEqual(['access_token', 'refresh_token', REMEMBER_ME_COOKIE]);
    for (const name of ['access_token', 'refresh_token']) {
      const c = byName(calls, name)!;
      expect(c.opts.maxAge).toBeUndefined();
      expect(c.opts.path).toBe('/');
    }
    // Stale marker from a prior remember-me login on this browser is wiped (Max-Age 0).
    expect(byName(calls, REMEMBER_ME_COOKIE)!.opts.maxAge).toBe(0);
  });

  it('writes persistent cookies with maxAge on both tokens and the marker when opted in', () => {
    const { res, calls } = fakeResponse();
    setSessionCookies(res, 'access', 'refresh', { maxAge: REMEMBER_ME_MAX_AGE_SECONDS });
    for (const name of ['access_token', 'refresh_token', REMEMBER_ME_COOKIE]) {
      expect(byName(calls, name)!.opts.maxAge).toBe(REMEMBER_ME_MAX_AGE_SECONDS);
    }
    // The marker records the intent, not a secret — value is a bare flag.
    expect(byName(calls, REMEMBER_ME_COOKIE)!.value).toBe('1');
  });

  it('documents the coupling: remember-me lifetime stays within the identity refresh TTL default', () => {
    // Operational coupling, not runtime-enforced: identity.jwt.refresh_ttl_seconds default is 30 days.
    const IDENTITY_REFRESH_TTL_DEFAULT_SECONDS = 2_592_000;
    expect(REMEMBER_ME_MAX_AGE_SECONDS).toBeLessThanOrEqual(IDENTITY_REFRESH_TTL_DEFAULT_SECONDS);
  });
});

describe('clearSessionCookies', () => {
  it('clears the remember-me marker alongside both auth cookies', () => {
    const { res, calls } = fakeResponse();
    clearSessionCookies(res);
    expect(calls.map((c) => c.name)).toEqual(['access_token', 'refresh_token', REMEMBER_ME_COOKIE]);
    for (const c of calls) {
      expect(c.opts.maxAge).toBe(0);
      expect(c.opts.path).toBe('/');
    }
  });
});

describe('rememberMeOptsFromRequest — persistence recovered from the marker on refresh', () => {
  const requestWith = (cookie: string) =>
    new NextRequest(new URL('http://localhost/trader'), { headers: { cookie } });

  it('re-applies the extended-session maxAge when the marker is present', () => {
    const opts = rememberMeOptsFromRequest(requestWith(`${REMEMBER_ME_COOKIE}=1`));
    expect(opts).toEqual({ maxAge: REMEMBER_ME_MAX_AGE_SECONDS });
  });

  it('returns undefined (session cookies preserved) when the marker is absent', () => {
    expect(rememberMeOptsFromRequest(requestWith('access_token=x'))).toBeUndefined();
  });

  it('returns undefined for any marker value other than the "1" flag', () => {
    expect(rememberMeOptsFromRequest(requestWith(`${REMEMBER_ME_COOKIE}=0`))).toBeUndefined();
  });
});
