// BFF transport deadline against a real socket (feature 271, @AC-1 / @AC-6). A secure h2 server that
// accepts the mTLS handshake but never answers stands in for a hung backend. Browserless.
import { test, expect } from '@playwright/test';
import * as http2 from 'node:http2';
import { Code, ConnectError } from '@connectrpc/connect';
import { devCerts } from './helpers/devCerts';
import { tlsOptions } from './mock-backend';
import { DEFAULT_UNARY_TIMEOUT_MS } from '../src/lib/deadlines';

let server: http2.Http2SecureServer;
const serverSessions = new Set<http2.ServerHttp2Session>();
let configClient: typeof import('../src/lib/connectClients').configClient;

test.beforeAll(async () => {
  server = http2.createSecureServer(tlsOptions(), () => {});
  server.on('session', (s) => {
    serverSessions.add(s);
    s.on('close', () => serverSessions.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  const { ca, uiCert, uiKey } = devCerts();
  process.env.MTLS_CERT = uiCert;
  process.env.MTLS_KEY = uiKey;
  process.env.MTLS_CA_CERT = ca;
  // connectClients reads *_ENDPOINT at module load, so the env must be set before the import.
  process.env.CONFIG_ENDPOINT = `127.0.0.1:${port}`;
  ({ configClient } = await import('../src/lib/connectClients'));
});

test.afterAll(async () => {
  for (const s of serverSessions) s.destroy();
  await new Promise<void>((resolve) => {
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close(() => resolve());
    setTimeout(resolve, 2000).unref();
  });
});

async function deadlineError(call: Promise<unknown>): Promise<{ code: Code; elapsed: number }> {
  const t0 = Date.now();
  const err = await call.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (e: unknown) => e,
  );
  return { code: ConnectError.from(err).code, elapsed: Date.now() - t0 };
}

test('@AC-1: an un-timed unary call against a black hole fails at the default deadline', async () => {
  test.setTimeout(DEFAULT_UNARY_TIMEOUT_MS + 30_000);
  const { code, elapsed } = await deadlineError(configClient.getConfig({ namespace: 'ui' }));
  expect(code).toBe(Code.DeadlineExceeded);
  expect(elapsed).toBeGreaterThanOrEqual(DEFAULT_UNARY_TIMEOUT_MS - 1_000);
  expect(elapsed).toBeLessThanOrEqual(DEFAULT_UNARY_TIMEOUT_MS + 5_000);
});

test('@AC-6: a per-call timeoutMs overrides the default', async () => {
  const { code, elapsed } = await deadlineError(
    configClient.getConfig({ namespace: 'ui' }, { timeoutMs: 2000 }),
  );
  expect(code).toBe(Code.DeadlineExceeded);
  expect(elapsed).toBeLessThanOrEqual(5_000);
});
