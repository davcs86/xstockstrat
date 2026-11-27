// C-12: discovery documents and URLs are scenario one-offs; no domain object.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { __resetOidcConfigurationCache, getOidcConfiguration } from './oidcClient';
import { endSessionUrl, portalLogoutUrl, resolveLogoutRedirect } from './ssoLogout';

const ISSUER = 'https://auth.example.test';
const APP = 'https://xstockstrat-staging.example.test';
const CLIENT_ID = 'xstockstrat-staging-web';
const PORTAL = `${ISSUER}/logout?rd=https%3A%2F%2Fxstockstrat-staging.example.test%2Fauth%2Flogin`;
const CFG = { issuer: ISSUER, clientId: CLIENT_ID, appOrigin: APP };

let doc: Record<string, unknown>;
let hits: number;
let respond: () => Promise<Response>;

beforeEach(() => {
  __resetOidcConfigurationCache();
  doc = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/oidc/authorization`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
  };
  hits = 0;
  respond = async () => Response.json(doc);
  vi.stubGlobal('fetch', async () => {
    hits++;
    return respond();
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const warns = () =>
  vi.mocked(console.warn).mock.calls.filter((c) => c[0] === 'sso_logout_portal_fallback');

test('@AC-53 the portal URL returns to /auth/login on the app origin', () => {
  expect(portalLogoutUrl(ISSUER, APP)).toBe(PORTAL);
});

test('@AC-53 no end_session_endpoint → the portal URL', async () => {
  expect(await resolveLogoutRedirect(CFG, 'secret')).toBe(PORTAL);
  expect(warns()).toHaveLength(0);
});

test('@AC-52 an advertised same-origin end_session_endpoint → that URL with the return and client id', async () => {
  doc.end_session_endpoint = `${ISSUER}/api/oidc/end-session`;
  const url = new URL(await resolveLogoutRedirect(CFG, 'secret'));
  expect(url.origin + url.pathname).toBe(`${ISSUER}/api/oidc/end-session`);
  expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${APP}/auth/login`);
  expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
  const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, 'secret');
  expect(endSessionUrl(cfg, APP, CLIENT_ID)).toBe(url.href);
});

test('a cross-origin end_session_endpoint → the portal URL', async () => {
  doc.end_session_endpoint = 'https://sso.example.test/end-session';
  expect(await resolveLogoutRedirect(CFG, 'secret')).toBe(PORTAL);
});

test('secret === null → the portal URL with no discovery call (D-134)', async () => {
  expect(await resolveLogoutRedirect(CFG, null)).toBe(PORTAL);
  expect(hits).toBe(0);
});

test('a discovery throw → the portal URL + one sso_logout_portal_fallback WARN', async () => {
  respond = async () => new Response('boom', { status: 500 });
  expect(await resolveLogoutRedirect(CFG, 'secret')).toBe(PORTAL);
  expect(warns()).toHaveLength(1);
});

test('a discovery timeout → the portal URL + one sso_logout_portal_fallback WARN', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  respond = () => new Promise<Response>(() => {});
  const pending = resolveLogoutRedirect(CFG, 'secret');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending).toBe(PORTAL);
  expect(warns()).toHaveLength(1);
});
