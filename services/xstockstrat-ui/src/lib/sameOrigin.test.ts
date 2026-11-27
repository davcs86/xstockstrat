// C-12: origins and APP_URL values are scenario one-offs; no domain object.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { __resetLogOnce } from './serverLog';
import { appOrigin, isSameOrigin, originHost } from './sameOrigin';

const APP = 'https://xstockstrat-staging.example.test';

function req(origin?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set('origin', origin);
  return new Request(`${APP}/api/auth/logout`, { method: 'POST', headers });
}

beforeEach(() => {
  __resetLogOnce();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('APP_URL', APP);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test('required: a missing Origin fails (@AC-59)', () => {
  expect(isSameOrigin(req(), 'required')).toBe(false);
});

test("required: a 'null' Origin fails", () => {
  expect(isSameOrigin(req('null'), 'required')).toBe(false);
});

test('required: the exact app origin passes', () => {
  expect(isSameOrigin(req(APP), 'required')).toBe(true);
});

test('required: another port or scheme fails', () => {
  expect(isSameOrigin(req(`${APP}:8443`), 'required')).toBe(false);
  expect(isSameOrigin(req('http://xstockstrat-staging.example.test'), 'required')).toBe(false);
});

test('required: a null appOrigin fails closed', () => {
  vi.stubEnv('APP_URL', 'https://x.test/');
  expect(isSameOrigin(req(APP), 'required')).toBe(false);
});

test('if_present: an absent Origin passes', () => {
  expect(isSameOrigin(req(), 'if_present')).toBe(true);
});

test('if_present: the exact app origin passes', () => {
  expect(isSameOrigin(req(APP), 'if_present')).toBe(true);
});

test('@AC-57 if_present: a sibling origin fails', () => {
  expect(isSameOrigin(req('https://dashboard.example.test'), 'if_present')).toBe(false);
});

test("if_present: a 'null' Origin fails", () => {
  expect(isSameOrigin(req('null'), 'if_present')).toBe(false);
});

test('@AC-58 if_present: a null appOrigin fails open for a sibling origin', () => {
  vi.stubEnv('APP_URL', 'not a url');
  expect(isSameOrigin(req('https://dashboard.example.test'), 'if_present')).toBe(true);
});

test('an explicit origin argument overrides APP_URL', () => {
  expect(isSameOrigin(req('http://localhost:3000'), 'required', 'http://localhost:3000')).toBe(
    true,
  );
});

test('an invalid or unset APP_URL logs one app_url_invalid ERROR across repeated calls', () => {
  vi.stubEnv('APP_URL', undefined);
  expect(appOrigin()).toBeNull();
  expect(appOrigin()).toBeNull();
  isSameOrigin(req(APP), 'if_present');
  const calls = vi.mocked(console.error).mock.calls.filter((c) => c[0] === 'app_url_invalid');
  expect(calls).toEqual([['app_url_invalid', { reason: 'app_url' }]]);
});

test('a valid APP_URL logs nothing', () => {
  expect(appOrigin()).toBe(APP);
  expect(console.error).not.toHaveBeenCalled();
});

test('originHost returns the host of a present Origin', () => {
  expect(originHost('https://dashboard.example.test:8443')).toBe('dashboard.example.test:8443');
  expect(originHost('null')).toBe('null');
  expect(originHost('::garbage::')).toBe('invalid');
});
