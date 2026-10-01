// BFF→backend mutual-TLS handshake contract (feature 210, Step 10 / @AC-4).
//
// Exercises the real security contract the BFF relies on: connectClients.ts makeTransport builds a
// connect-node transport over `https://<endpoint>` with nodeOptions { ca, cert, key,
// checkServerIdentity → pin to the TARGET SERVICE NAME }, and e2e/mock-backend.ts serves every mock
// over http2.createSecureServer(tlsOptions()) requiring a CA-signed client cert. This spec stands up a
// secure h2 server with the SAME tlsOptions() the mocks use and asserts, against the SAME devCerts()
// material the BFF is handed in playwright.config.ts:
//   • a client presenting the UI leaf and pinning to a served SAN handshakes and gets a response;
//   • a plaintext client against the now-TLS server is refused (@AC-4 — verification cannot be off);
//   • a client with no client cert is refused (mutual auth is required, not optional);
//   • pinning the authority to a name the server cert does NOT carry is rejected (the pin is real).
// No browser or Next build is needed — this is the transport-layer contract, run under the Playwright
// runner for CI co-location.
import { test, expect } from '@playwright/test';
import * as http2 from 'node:http2';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import { devCerts } from './helpers/devCerts';
import { tlsOptions } from './mock-backend';

// A served SAN on the multi-SAN mock leaf (devCerts BACKEND_SERVICES) and one that is NOT served.
const SERVED_TARGET = 'xstockstrat-config';
const UNSERVED_TARGET = 'xstockstrat-nonesuch';
const REFUSAL_BUDGET_MS = 4000;

let server: http2.Http2SecureServer;
let port: number;
const serverSessions = new Set<http2.ServerHttp2Session>();

test.beforeAll(async () => {
  server = http2.createSecureServer(tlsOptions(), (_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  // Destroy server-side sessions on teardown so a leftover h2 session (e.g. a client that failed the
  // client-side authority pin AFTER the handshake completed) cannot stall server.close().
  server.on('session', (s) => {
    serverSessions.add(s);
    s.on('close', () => serverSessions.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as { port: number }).port;
});

test.afterAll(async () => {
  for (const s of serverSessions) s.destroy();
  await new Promise<void>((resolve) => {
    // destroy lingering raw TCP sockets from failed-handshake dials (net.Server method, not in the
    // @types/node http2 surface; present at runtime)
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close(() => resolve());
    setTimeout(resolve, 2000).unref(); // fallback — never hang teardown
  });
});

// Open an h2 session the way connectClients.makeTransport does: present the UI client leaf + CA and
// pin the verified server authority to `target` (NOT the dialed host). Resolves on connect, rejects
// on any TLS/handshake error.
function dialMtls(target: string): Promise<http2.ClientHttp2Session> {
  const { ca, uiCert, uiKey } = devCerts();
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      ca,
      cert: uiCert,
      key: uiKey,
      checkServerIdentity: (_host: string, peer: PeerCertificate) =>
        checkServerIdentity(target, peer),
    });
    session.on('connect', () => resolve(session));
    session.on('error', (err) => {
      session.destroy();
      reject(err);
    });
  });
}

async function headStatus(session: http2.ClientHttp2Session): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = session.request({ ':method': 'GET', ':path': '/' });
    req.on('response', (h) => resolve(Number(h[':status'])));
    req.on('error', reject);
    req.end();
  });
}

// Returns the HTTP status if a full round-trip completes within the budget, or the sentinel
// 'refused' if the connection errors, times out, or is torn down without a response — the handshake
// could not be established. The session is always destroyed so it cannot stall teardown.
async function statusOrRefused(
  opts: http2.SecureClientSessionOptions,
  scheme: 'http' | 'https',
): Promise<number | 'refused'> {
  let session: http2.ClientHttp2Session | undefined;
  try {
    return await new Promise<number | 'refused'>((resolve) => {
      const timer = setTimeout(() => resolve('refused'), REFUSAL_BUDGET_MS);
      const done = (v: number | 'refused') => {
        clearTimeout(timer);
        resolve(v);
      };
      session = http2.connect(`${scheme}://127.0.0.1:${port}`, opts);
      session.on('error', () => done('refused'));
      session.on('connect', () => {
        const req = session!.request({ ':method': 'GET', ':path': '/' });
        req.on('response', (h) => done(Number(h[':status'])));
        req.on('error', () => done('refused'));
        req.end();
      });
    });
  } finally {
    session?.destroy();
  }
}

test('@AC-4: mutual-TLS client presenting the UI leaf, pinned to a served SAN, handshakes', async () => {
  const session = await dialMtls(SERVED_TARGET);
  expect(await headStatus(session)).toBe(200);
  session.close();
});

test('@AC-4: a plaintext client against the TLS server is refused', async () => {
  expect(await statusOrRefused({}, 'http')).toBe('refused');
});

test('@AC-4: a client with no client certificate is refused (mutual auth required)', async () => {
  const { ca } = devCerts();
  const result = await statusOrRefused(
    {
      ca,
      checkServerIdentity: (_h: string, peer: PeerCertificate) =>
        checkServerIdentity(SERVED_TARGET, peer),
    },
    'https',
  );
  expect(result).toBe('refused');
});

test('the authority pin is real: pinning to a name the server cert does not carry is rejected', async () => {
  await expect(dialMtls(UNSERVED_TARGET)).rejects.toBeTruthy();
});
