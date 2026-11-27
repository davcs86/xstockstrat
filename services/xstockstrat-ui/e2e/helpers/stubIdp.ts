/**
 * Stub OIDC issuer for the SSO e2e (feature 345). Runs in the global-setup process beside the mock
 * gRPC backend, which reads `ssoStubState` for the mode, config and identity answers it serves.
 * Specs drive it over HTTP: POST /__test/state (merge), POST /__test/reset, GET /__test/state.
 */
import * as http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import {
  SSO_IDENTITY,
  SSO_STAGING_CLIENT_IDS,
  SSO_WEB_CLIENT_ID,
  SSO_WEB_CLIENT_SECRET,
  STUB_IDP_PORT,
  ssoDiscoveryDocument,
  stubIssuer,
} from '../fixtures';

export type SsoStubState = {
  /** identity/auth.mode as served by the mock; null = the row is absent (reads as local). */
  mode: string | null;
  /** Every mock GetConfig and GetSecret throws Unavailable. */
  getConfigFails: boolean;
  uiIssuer: string;
  uiClientId: string;
  secretFound: boolean;
  agentIssuer: string;
  mcpClientIds: typeof SSO_STAGING_CLIENT_IDS;
  /** FailedPrecondition details the identity mock answers with; null = success. */
  resolveRefusal: string | null;
  issueRefusal: string | null;
  linkRefusal: string | null;
  claims: { sub: string; email?: string; preferred_username?: string };
  authTime: 'fresh' | 'absent' | 'stale';
  signWith: 'issuer' | 'foreign';
  endSession: boolean;
  /** Every IdP endpoint (not /__test/*) drops the connection. */
  down: boolean;
};

export type SsoStubRecord = {
  authorize: { prompt: string | null; max_age: string | null }[];
  logout: string[];
  links: { userId: string; issuer: string; subject: string }[];
};

function defaults(): SsoStubState {
  return {
    mode: null,
    getConfigFails: false,
    uiIssuer: stubIssuer(),
    uiClientId: SSO_WEB_CLIENT_ID,
    secretFound: true,
    agentIssuer: stubIssuer(),
    mcpClientIds: { ...SSO_STAGING_CLIENT_IDS },
    resolveRefusal: null,
    issueRefusal: null,
    linkRefusal: null,
    claims: {
      sub: SSO_IDENTITY.subject,
      email: SSO_IDENTITY.email,
      preferred_username: SSO_IDENTITY.preferredUsername,
    },
    authTime: 'fresh',
    signWith: 'issuer',
    endSession: false,
    down: false,
  };
}

export const ssoStubState: SsoStubState = defaults();
export const ssoStubRecord: SsoStubRecord = { authorize: [], logout: [], links: [] };

function reset(): void {
  Object.assign(ssoStubState, defaults());
  ssoStubRecord.authorize.length = 0;
  ssoStubRecord.logout.length = 0;
  ssoStubRecord.links.length = 0;
}

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
type Keys = { issuer: PrivateKey; foreign: PrivateKey; jwk: JWK };
let keys: Keys | null = null;
let server: http.Server | null = null;
const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();

async function loadKeys(): Promise<Keys> {
  const issuer = await generateKeyPair('RS256', { extractable: true });
  const foreign = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(issuer.publicKey)), kid: 'stub-1', alg: 'RS256', use: 'sig' };
  return { issuer: issuer.privateKey, foreign: foreign.privateKey, jwk };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function idToken(clientId: string, nonce: string): Promise<string> {
  const k = keys!;
  const now = Math.floor(Date.now() / 1000);
  const authTime =
    ssoStubState.authTime === 'fresh' ? now : ssoStubState.authTime === 'stale' ? now - 3600 : null;
  return new SignJWT({
    ...ssoStubState.claims,
    nonce,
    ...(authTime === null ? {} : { auth_time: authTime }),
  })
    .setProtectedHeader({
      alg: 'RS256',
      kid: ssoStubState.signWith === 'foreign' ? 'foreign' : 'stub-1',
    })
    .setIssuer(stubIssuer())
    .setAudience(clientId)
    .setSubject(ssoStubState.claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(ssoStubState.signWith === 'foreign' ? k.foreign : k.issuer);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', stubIssuer());
  if (url.pathname === '/__test/state') {
    if (req.method === 'GET') return json(res, 200, { state: ssoStubState, record: ssoStubRecord });
    const patch = JSON.parse((await readBody(req)) || '{}') as Partial<SsoStubState>;
    Object.assign(ssoStubState, patch);
    return json(res, 200, { state: ssoStubState });
  }
  if (url.pathname === '/__test/reset') {
    reset();
    return json(res, 200, { state: ssoStubState });
  }
  if (ssoStubState.down) {
    req.socket.destroy();
    return;
  }
  switch (url.pathname) {
    case '/.well-known/openid-configuration':
      return json(
        res,
        200,
        ssoDiscoveryDocument(stubIssuer(), { endSession: ssoStubState.endSession }),
      );
    case '/jwks':
      return json(res, 200, { keys: [keys!.jwk] });
    case '/authorize': {
      const q = url.searchParams;
      ssoStubRecord.authorize.push({ prompt: q.get('prompt'), max_age: q.get('max_age') });
      const code = randomUUID();
      codes.set(code, {
        nonce: q.get('nonce') ?? '',
        challenge: q.get('code_challenge') ?? '',
        redirectUri: q.get('redirect_uri') ?? '',
      });
      const back = new URL(q.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state') ?? '');
      res.writeHead(302, { location: back.href });
      return void res.end();
    }
    case '/token': {
      const form = new URLSearchParams(await readBody(req));
      const basic = Buffer.from(
        `${encodeURIComponent(SSO_WEB_CLIENT_ID)}:${encodeURIComponent(SSO_WEB_CLIENT_SECRET)}`,
      ).toString('base64');
      if (req.headers.authorization !== `Basic ${basic}`) {
        return json(res, 401, { error: 'invalid_client' });
      }
      const grant = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (
        !grant ||
        grant.challenge !== challenge ||
        grant.redirectUri !== form.get('redirect_uri')
      ) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      return json(res, 200, {
        access_token: randomUUID(),
        token_type: 'Bearer',
        expires_in: 300,
        id_token: await idToken(SSO_WEB_CLIENT_ID, grant.nonce),
      });
    }
    case '/logout':
      ssoStubRecord.logout.push(url.search);
      res.writeHead(200, { 'content-type': 'text/html' });
      return void res.end('<!doctype html><title>Signed out</title><p>Signed out</p>');
    default:
      return json(res, 404, { error: 'not_found' });
  }
}

export async function startStubIdp(): Promise<void> {
  reset();
  keys ??= await loadKeys();
  server = http.createServer((req, res) => {
    handle(req, res).catch(() => json(res, 500, { error: 'server_error' }));
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(STUB_IDP_PORT, '127.0.0.1', () => resolve());
  });
}

export async function stopStubIdp(): Promise<void> {
  const srv = server;
  server = null;
  if (!srv) return;
  srv.closeAllConnections();
  await new Promise<void>((resolve) => srv.close(() => resolve()));
}

/** Spec-side controls (Playwright workers run in other processes). */
export async function setSsoState(
  request: APIRequestContext,
  patch: Partial<SsoStubState>,
): Promise<void> {
  const res = await request.post(`${stubIssuer()}/__test/state`, { data: patch });
  if (!res.ok()) throw new Error(`stub IdP state update failed: ${res.status()}`);
}

export async function resetSsoState(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${stubIssuer()}/__test/reset`);
  if (!res.ok()) throw new Error(`stub IdP reset failed: ${res.status()}`);
}

export async function readSsoRecord(request: APIRequestContext): Promise<SsoStubRecord> {
  const res = await request.get(`${stubIssuer()}/__test/state`);
  return ((await res.json()) as { record: SsoStubRecord }).record;
}
