import { describe, it, expect, afterEach } from 'vitest';
import { buildInternalRefreshUrl, setSessionCookies, REMEMBER_ME_MAX_AGE_SECONDS } from './auth';
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

const ORIGINAL_PORT = process.env.PORT;

afterEach(() => {
  if (ORIGINAL_PORT === undefined) delete process.env.PORT;
  else process.env.PORT = ORIGINAL_PORT;
});

describe('buildInternalRefreshUrl', () => {
  it('loops back over plain HTTP to 127.0.0.1, never the request origin', () => {
    delete process.env.PORT;
    const url = buildInternalRefreshUrl();
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toBe('/api/auth/refresh');
  });

  it('defaults to port 3000 when PORT is unset (matches Dockerfile EXPOSE)', () => {
    delete process.env.PORT;
    expect(buildInternalRefreshUrl().port).toBe('3000');
  });

  it('honors PORT when the platform sets one', () => {
    process.env.PORT = '8080';
    expect(buildInternalRefreshUrl().port).toBe('8080');
  });
});

describe('setSessionCookies — extended session (feature 153)', () => {
  it('writes session cookies (no maxAge) by default', () => {
    const { res, calls } = fakeResponse();
    setSessionCookies(res, 'access', 'refresh');
    expect(calls.map((c) => c.name)).toEqual(['access_token', 'refresh_token']);
    for (const c of calls) {
      expect(c.opts.maxAge).toBeUndefined();
      expect(c.opts.path).toBe('/');
    }
  });

  it('writes persistent cookies with maxAge on both when opted in', () => {
    const { res, calls } = fakeResponse();
    setSessionCookies(res, 'access', 'refresh', { maxAge: REMEMBER_ME_MAX_AGE_SECONDS });
    for (const c of calls) {
      expect(c.opts.maxAge).toBe(REMEMBER_ME_MAX_AGE_SECONDS);
    }
  });

  it('documents the coupling: remember-me lifetime stays within the identity refresh TTL default', () => {
    // Operational coupling, not runtime-enforced: identity.jwt.refresh_ttl_seconds default is 30 days.
    const IDENTITY_REFRESH_TTL_DEFAULT_SECONDS = 2_592_000;
    expect(REMEMBER_ME_MAX_AGE_SECONDS).toBeLessThanOrEqual(IDENTITY_REFRESH_TTL_DEFAULT_SECONDS);
  });
});
