// C-12: the stub issuer's discovery, JWKS and token documents are scenario one-offs (the e2e stub IdP's
// live in e2e/fixtures/); no domain object.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import {
  __resetOidcConfigurationCache,
  buildSsoAuthorizationUrl,
  exchangeCode,
  getOidcConfiguration,
  OIDC_SCOPE,
} from './oidcClient';

const ISSUER = 'https://auth.example.test';
const CLIENT_ID = 'xstockstrat-staging-web';
const SECRET = 'web-client-secret';
const REDIRECT = 'https://xstockstrat-staging.example.test/api/auth/sso/callback';
const KID = 'k1';

let rsaPriv: KeyLike;
let foreignPriv: KeyLike;
let ecPriv: KeyLike;
let jwks: { keys: object[] };

let discoveryDoc: Record<string, unknown>;
let discoveryHits: number;
let discoveryGate: (() => Promise<Response>) | null;
let idToken: string;
let tokenAuth: string | null;

function stubFetch() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/.well-known/openid-configuration')) {
      discoveryHits++;
      if (discoveryGate) return discoveryGate();
      return Response.json(discoveryDoc);
    }
    if (url === `${ISSUER}/jwks`) return Response.json(jwks);
    if (url === `${ISSUER}/token`) {
      tokenAuth = new Headers(init?.headers).get('authorization');
      return Response.json({
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: idToken,
      });
    }
    return new Response('not found', { status: 404 });
  });
}

async function sign(
  claims: Record<string, unknown>,
  { key = rsaPriv, alg = 'RS256', kid = KID }: { key?: KeyLike; alg?: string; kid?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'authelia-sub-1',
    nonce: 'n-1',
    iat: now,
    exp: now + 300,
    auth_time: now - 5,
    email: 'trader@example.test',
    preferred_username: 'trader',
    ...claims,
  })
    .setProtectedHeader({ alg, kid })
    .sign(key);
}

async function failure(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: Error & { cause?: { message?: string } }) => e,
  );
  return `${err.message} | ${err.cause?.message ?? ''}`;
}

const callback = (state = 's-1') => new URL(`${REDIRECT}?code=c-1&state=${state}`);
const checks = { pkceCodeVerifier: 'v'.repeat(43), expectedState: 's-1', expectedNonce: 'n-1' };

beforeAll(async () => {
  const rsa = await generateKeyPair('RS256');
  rsaPriv = rsa.privateKey;
  foreignPriv = (await generateKeyPair('RS256')).privateKey;
  ecPriv = (await generateKeyPair('ES256')).privateKey;
  jwks = { keys: [{ ...(await exportJWK(rsa.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] };
});

beforeEach(() => {
  __resetOidcConfigurationCache();
  discoveryDoc = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/api/oidc/authorization`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    id_token_signing_alg_values_supported: ['RS256'],
  };
  discoveryHits = 0;
  discoveryGate = null;
  tokenAuth = null;
  stubFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('exchangeCode', () => {
  test('a correctly signed ID token → the validated claims only', async () => {
    idToken = await sign({});
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    const claims = await exchangeCode(cfg, callback(), checks);
    expect(claims).toEqual({
      iss: ISSUER,
      sub: 'authelia-sub-1',
      email: 'trader@example.test',
      preferred_username: 'trader',
      auth_time: expect.any(Number),
    });
    const [user, pass] = Buffer.from(tokenAuth!.replace(/^Basic /, ''), 'base64')
      .toString()
      .split(':')
      .map(decodeURIComponent);
    expect([user, pass]).toEqual([CLIENT_ID, SECRET]);
  });

  test('an ID token without auth_time still returns claims (D-127)', async () => {
    idToken = await sign({ auth_time: undefined });
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    const claims = await exchangeCode(cfg, callback(), checks);
    expect(claims.auth_time).toBeUndefined();
    expect(claims.sub).toBe('authelia-sub-1');
  });

  test('@AC-24 a foreign key with the same kid rejects (non-repudiation checks active)', async () => {
    idToken = await sign({}, { key: foreignPriv });
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(await failure(exchangeCode(cfg, callback(), checks))).toMatch(
      /JWT signature verification failed/,
    );
  });

  test('a nonce mismatch rejects', async () => {
    idToken = await sign({ nonce: 'other' });
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(await failure(exchangeCode(cfg, callback(), checks))).toMatch(/"nonce" claim/);
  });

  test('an aud mismatch rejects', async () => {
    idToken = await sign({ aud: 'another-client' });
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(await failure(exchangeCode(cfg, callback(), checks))).toMatch(/"aud" \(audience\)/);
  });

  test('a state mismatch rejects', async () => {
    idToken = await sign({});
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(await failure(exchangeCode(cfg, callback('other'), checks))).toMatch(
      /"state" response parameter/,
    );
  });

  test('an ES256 ID token rejects', async () => {
    idToken = await sign({}, { key: ecPriv, alg: 'ES256' });
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(await failure(exchangeCode(cfg, callback(), checks))).toMatch(/"alg" header parameter/);
  });

  test("an alg 'none' ID token rejects", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    idToken = `${enc({ alg: 'none' })}.${enc({ iss: ISSUER, aud: CLIENT_ID, sub: 's', nonce: 'n-1', iat: now, exp: now + 300 })}.`;
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(await failure(exchangeCode(cfg, callback(), checks))).toMatch(/"alg" header parameter/);
  });
});

describe('buildSsoAuthorizationUrl', () => {
  const params = { redirectUri: REDIRECT, state: 's-1', nonce: 'n-1', codeChallenge: 'cc' };

  test('the login URL carries the scope, query mode and S256, and no prompt or max_age', async () => {
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    const url = buildSsoAuthorizationUrl(cfg, params);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/api/oidc/authorization`);
    expect(OIDC_SCOPE).toBe('openid email profile');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('cc');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('s-1');
    expect(url.searchParams.get('nonce')).toBe('n-1');
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.has('max_age')).toBe(false);
  });

  test('the link URL adds prompt=login and max_age=1 (D-139)', async () => {
    const cfg = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    const url = buildSsoAuthorizationUrl(cfg, { ...params, link: true });
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('max_age')).toBe('1');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('the Configuration cache', () => {
  test('the same key within 600 s → one discovery; after 601 s → a refetch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T00:00:00Z'));
    const first = await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    vi.setSystemTime(new Date('2026-11-27T00:09:59Z'));
    expect(await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET)).toBe(first);
    expect(discoveryHits).toBe(1);
    vi.setSystemTime(new Date('2026-11-27T00:10:01Z'));
    expect(await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET)).not.toBe(first);
    expect(discoveryHits).toBe(2);
  });

  test('a rotated secret → a second discovery', async () => {
    await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    await getOidcConfiguration(ISSUER, CLIENT_ID, 'rotated');
    expect(discoveryHits).toBe(2);
  });

  test('a rejected discovery is not cached', async () => {
    discoveryGate = async () => new Response('boom', { status: 500 });
    expect(await failure(getOidcConfiguration(ISSUER, CLIENT_ID, SECRET))).toMatch(
      /unexpected HTTP response status code/,
    );
    discoveryGate = null;
    await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(discoveryHits).toBe(2);
  });

  test('a stale rejection does not clear a newer slot', async () => {
    let fail!: () => void;
    discoveryGate = () =>
      new Promise<Response>((resolve) => {
        fail = () => resolve(new Response('boom', { status: 500 }));
      });
    const stale = getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    await vi.waitFor(() => expect(discoveryHits).toBe(1));
    discoveryGate = null;
    const newer = await getOidcConfiguration(ISSUER, CLIENT_ID, 'rotated');
    fail();
    expect(await failure(stale)).toMatch(/unexpected HTTP response status code/);
    expect(await getOidcConfiguration(ISSUER, CLIENT_ID, 'rotated')).toBe(newer);
    expect(discoveryHits).toBe(2);
  });

  test('a trailing-slash discovered issuer rejects', async () => {
    discoveryDoc.issuer = `${ISSUER}/`;
    expect(await failure(getOidcConfiguration(ISSUER, CLIENT_ID, SECRET))).toMatch(
      /discovered issuer does not match/,
    );
  });

  test('a configured /.well-known/ issuer rejects', async () => {
    expect(
      await failure(
        getOidcConfiguration(`${ISSUER}/.well-known/openid-configuration`, CLIENT_ID, SECRET),
      ),
    ).toMatch(/discovered issuer does not match/);
  });

  test('a cross-origin jwks_uri rejects and the next call rediscovers', async () => {
    discoveryDoc.jwks_uri = 'https://keys.example.test/jwks';
    expect(await failure(getOidcConfiguration(ISSUER, CLIENT_ID, SECRET))).toMatch(
      /jwks_uri is not same-origin/,
    );
    discoveryDoc.jwks_uri = `${ISSUER}/jwks`;
    await getOidcConfiguration(ISSUER, CLIENT_ID, SECRET);
    expect(discoveryHits).toBe(2);
  });
});
