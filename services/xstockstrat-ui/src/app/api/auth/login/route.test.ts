// C-12: credentials and Connect errors are scenario one-offs; no domain object.
import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';

const { authenticateUser, recordAuthEvent } = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  recordAuthEvent: vi.fn(),
}));
vi.mock('@/lib/connectClients', () => ({ identityClient: { authenticateUser } }));
vi.mock('@/lib/bffMetrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bffMetrics')>()),
  recordAuthEvent,
}));

const { POST } = await import('./route');

const login = () =>
  POST(
    new NextRequest('https://xstockstrat-staging.example.test/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'trader@example.test', password: 'pw' }),
    }),
  );

beforeEach(() => {
  authenticateUser.mockReset();
  recordAuthEvent.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

test('@AC-16 PermissionDenied (oidc password gate) → 403 login_disabled + the login_disabled event', async () => {
  authenticateUser.mockRejectedValue(
    new ConnectError('password login disabled', Code.PermissionDenied),
  );
  const res = await login();
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'login_disabled' });
  expect(recordAuthEvent.mock.calls).toEqual([['login_disabled']]);
  expect(res.headers.getSetCookie()).toEqual([]);
});

test('Unauthenticated keeps 401 "Invalid credentials" (@AC-33 @feature-294 PRESERVE)', async () => {
  authenticateUser.mockRejectedValue(new ConnectError('bad', Code.Unauthenticated));
  const res = await login();
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Invalid credentials' });
  expect(recordAuthEvent.mock.calls).toEqual([['login_failed']]);
});

test('any other code → 503', async () => {
  authenticateUser.mockRejectedValue(new ConnectError('down', Code.Unavailable));
  const res = await login();
  expect(res.status).toBe(503);
  expect(recordAuthEvent.mock.calls).toEqual([['login_error']]);
});
