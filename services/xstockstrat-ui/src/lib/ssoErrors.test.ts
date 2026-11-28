// C-12: refusal details and codes are scenario one-offs; no domain object.
import { beforeEach, expect, test, vi } from 'vitest';

const recordAuthEvent = vi.fn();
vi.mock('@/lib/bffMetrics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bffMetrics')>()),
  recordAuthEvent,
}));

const {
  LINK_ERROR_MESSAGES,
  linkRefusalCode,
  resolveRefusalCode,
  sessionRefusalCode,
  SSO_ERROR_MESSAGES,
  ssoErrorRedirect,
} = await import('./ssoErrors');

const APP = 'https://xstockstrat-staging.example.test';

beforeEach(() => recordAuthEvent.mockReset());

test('login destination: 303 to /auth/login?error= on the app origin + sso_login_failed{code}', () => {
  const res = ssoErrorRedirect({ dest: 'login', code: 'no_access' }, APP);
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe(`${APP}/auth/login?error=no_access`);
  expect(recordAuthEvent.mock.calls).toEqual([['sso_login_failed', 'no_access']]);
});

test('login destination with fault → sso_login_error only', () => {
  ssoErrorRedirect({ dest: 'login', code: 'failed' }, APP, { fault: true });
  expect(recordAuthEvent.mock.calls).toEqual([['sso_login_error']]);
});

test('link destination: 303 to /accounts/sso?error= + sso_link_failed{code}, never sso_login_*', () => {
  const res = ssoErrorRedirect({ dest: 'link', code: 'already_linked_self' }, APP, { fault: true });
  expect(res.headers.get('location')).toBe(`${APP}/accounts/sso?error=already_linked_self`);
  expect(recordAuthEvent.mock.calls).toEqual([['sso_link_failed', 'already_linked_self']]);
});

test('a null appOrigin → a relative Location', () => {
  const res = ssoErrorRedirect({ dest: 'login', code: 'not_configured' }, null);
  expect(res.headers.get('location')).toBe('/auth/login?error=not_configured');
});

test('clearTxnCookie expires the named txn cookie with Max-Age=0 on the callback path', () => {
  const res = ssoErrorRedirect({ dest: 'login', code: 'failed' }, APP, {
    clearTxnCookie: 'sso_txn_0123456789abcdef',
  });
  const [cookie] = res.headers.getSetCookie();
  expect(cookie).toMatch(/^sso_txn_0123456789abcdef=;/);
  expect(cookie).toContain('Max-Age=0');
  expect(cookie).toContain('Path=/api/auth/sso/callback');
  expect(cookie).toContain('HttpOnly');
});

test('no clearTxnCookie → no Set-Cookie', () => {
  const res = ssoErrorRedirect({ dest: 'login', code: 'failed' }, APP);
  expect(res.headers.getSetCookie()).toEqual([]);
});

test.each([
  ['not linked', 'not_linked'],
  ['account inactive', 'inactive'],
  ['sso disabled', 'failed'],
  ['something else', 'failed'],
] as const)('resolveRefusalCode(%s) → %s', (detail, code) => {
  expect(resolveRefusalCode(detail)).toBe(code);
});

test.each([
  ['account inactive', 'inactive'],
  ['sso disabled', 'failed'],
  ['something else', 'failed'],
] as const)('370 sessionRefusalCode(%s) → %s', (detail, code) => {
  expect(sessionRefusalCode(detail)).toBe(code);
});

test.each([
  ['invalid credentials', 'invalid_credentials'],
  ['account inactive', 'inactive'],
  ['account already linked', 'already_linked_other'],
  ['already linked to this issuer', 'already_linked_self'],
  ['link disabled', 'failed'],
  ['not linked', null],
] as const)('linkRefusalCode(%s) → %s', (detail, code) => {
  expect(linkRefusalCode(detail)).toBe(code);
});

test('every message is verbatim', () => {
  expect(SSO_ERROR_MESSAGES).toEqual({
    failed: 'Sign-in failed. Try again.',
    not_configured: 'SSO not configured',
    not_linked: {
      both: "Your single sign-on account isn't linked to an xstockstrat account. Sign in with your password and choose Link SSO, or ask an admin.",
      oidc: "Your single sign-on account isn't linked to an xstockstrat account. Ask an admin.",
    },
    inactive: 'This account is disabled. Ask an admin.',
    no_access: "You don't have access to xstockstrat. Ask an admin.",
  });
  expect(LINK_ERROR_MESSAGES).toEqual({
    failed: 'Sign-in failed. Try again.',
    not_configured: 'SSO not configured',
    no_access: "Your single sign-on account doesn't have access to xstockstrat. Ask an admin.",
    invalid_credentials: 'Incorrect password.',
    inactive: 'This account is disabled. Ask an admin.',
    already_linked_other: 'This sign-in is already linked to another account. Ask an admin.',
    already_linked_self:
      'This account is already linked to a single sign-on account. Ask an admin to unlink it first.',
  });
});
