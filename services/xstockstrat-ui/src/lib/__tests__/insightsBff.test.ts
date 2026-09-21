/**
 * Feature 183, AC-1 — BFF deadline plumbing.
 *
 * Verifies that `forward()` in bffShared.ts threads `timeoutMs` from its options into the
 * Connect-es CallOptions passed to the backend client method, and that callers without a
 * timeout leave it absent (non-breaking).
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the auth module so `requireSession` → `verifyAccessToken` resolves without real JWT.
vi.mock('@/lib/auth', () => ({
  verifyAccessToken: vi.fn(async () => ({
    user_id: 'u1',
    roles: ['user'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
  rolesToAccessScope: vi.fn(() => 7),
  generateTraceId: vi.fn(() => 'trace-test'),
  hasAdminScope: vi.fn(() => false),
}));

import { forward } from '@/lib/bffShared';
import { HEADER_USER_ID, HEADER_ACCESS_SCOPE, HEADER_TRACE_ID } from '@/lib/headers';
import type { HandlerContext } from '@connectrpc/connect';

/** Minimal HandlerContext stub — enough for `requireSession` + `backendHeaders`. */
function fakeCtx(): HandlerContext {
  const headers = new Headers({ cookie: 'access_token=test-jwt' });
  return {
    requestHeader: headers,
    responseHeader: new Headers(),
    responseTrailer: new Headers(),
    signal: new AbortController().signal,
  } as unknown as HandlerContext;
}

describe('forward() — timeoutMs threading (feature 183, AC-1)', () => {
  it('passes timeoutMs: 30_000 when options.timeoutMs is set', async () => {
    let capturedOpts: Record<string, unknown> = {};
    const mockCall = vi.fn(async (_req: unknown, opts: Record<string, unknown>) => {
      capturedOpts = opts;
      return { ok: true };
    });

    const handler = forward(mockCall, { timeoutMs: 30_000 });
    await handler({} as never, fakeCtx());

    expect(mockCall).toHaveBeenCalledOnce();
    expect(capturedOpts.timeoutMs).toBe(30_000);
    expect(capturedOpts.headers).toBeInstanceOf(Headers);
  });

  it('omits timeoutMs when options.timeoutMs is not set (non-breaking)', async () => {
    let capturedOpts: Record<string, unknown> = {};
    const mockCall = vi.fn(async (_req: unknown, opts: Record<string, unknown>) => {
      capturedOpts = opts;
      return { ok: true };
    });

    const handler = forward(mockCall);
    await handler({} as never, fakeCtx());

    expect(mockCall).toHaveBeenCalledOnce();
    expect(capturedOpts.timeoutMs).toBeUndefined();
    expect(capturedOpts.headers).toBeInstanceOf(Headers);
  });

  it('propagates identity headers alongside timeoutMs', async () => {
    let capturedOpts: { headers: Headers; timeoutMs?: number } | undefined;
    const mockCall = vi.fn(
      async (_req: unknown, opts: { headers: Headers; timeoutMs?: number }) => {
        capturedOpts = opts;
        return {};
      },
    );

    const handler = forward(mockCall, { timeoutMs: 30_000 });
    await handler({} as never, fakeCtx());

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts!.headers.get(HEADER_USER_ID)).toBe('u1');
    expect(capturedOpts!.headers.get(HEADER_ACCESS_SCOPE)).toBe('7');
    expect(capturedOpts!.headers.get(HEADER_TRACE_ID)).toBeTruthy();
    expect(capturedOpts!.timeoutMs).toBe(30_000);
  });
});
