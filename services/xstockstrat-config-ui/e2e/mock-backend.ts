/**
 * gRPC mock server for xstockstrat-config-ui E2E tests.
 *
 * Uses connectNodeAdapter + http2.createServer to serve real gRPC/H2C so the
 * production connectClients.ts (createGrpcTransport) needs no test-specific
 * overrides.  All mock endpoints are registered via router.service() so the
 * binary-proto serialization is handled by the connect-node runtime.
 *
 * Port 9093 — pointed at by CONFIG_ENDPOINT, IDENTITY_ENDPOINT, and
 * INGEST_ENDPOINT in playwright.config.ts.
 */
import * as http2 from 'node:http2';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { SignJWT } from 'jose';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export const MOCK_PORT = 9093;

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';

let server: http2.Http2Server | null = null;

export async function startMockBackend(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const testAccessToken = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret);

  const handler = connectNodeAdapter({
    routes(router) {
      router.service(ConfigService, {
        async listKeys() {
          return {
            keys: [
              { key: 'platform.log_level', description: 'Global log level for all services', defaultValue: 'info', isSecret: false, consumingService: 'all', environment: 1, tradingMode: 0 },
              { key: 'platform.maintenance_mode', description: 'Halts all trading operations when true', defaultValue: 'false', isSecret: false, consumingService: 'all', environment: 1, tradingMode: 0 },
              { key: 'secret.alpaca_api_key', description: 'Alpaca API key for live trading', defaultValue: '[secret]', isSecret: true, consumingService: 'trading', environment: 2, tradingMode: 2 },
            ],
          };
        },
        async setConfig() {
          return {};
        },
      });

      router.service(IdentityService, {
        async authenticateUser() {
          return {
            accessToken: testAccessToken,
            refreshToken: 'test-refresh-token',
            claims: { userId: 'test-user-001', email: 'test@example.com', roles: [] },
          };
        },
        async refreshToken() {
          return {
            accessToken: testAccessToken,
            refreshToken: 'test-refresh-token',
            claims: { userId: 'test-user-001', email: 'test@example.com', roles: [] },
          };
        },
        async revokeToken() {
          return { success: true };
        },
      });

      router.service(IngestService, {
        async listSignalSources() {
          return {
            sources: [{
              slug: 'example_simple_email',
              displayName: 'Example Simple Email',
              sourceType: 'simple_email',
              extractorModule: 'app.extractors.example_simple_email',
              active: true,
              hasCredentials: true,
              configJson: { sender_patterns: ['noreply@example.com'], subject_patterns: ['Signal:'] },
            }],
          };
        },
        async manageSignalSource() {
          return {
            source: {
              slug: 'example_simple_email',
              displayName: 'Example Simple Email',
              sourceType: 'simple_email',
              extractorModule: 'app.extractors.example_simple_email',
              active: true,
              hasCredentials: true,
              configJson: {},
            },
          };
        },
      });
    },
  });

  return new Promise((resolve, reject) => {
    server = http2.createServer(handler);
    server.on('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve());
  });
}

export function stopMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
  });
}
