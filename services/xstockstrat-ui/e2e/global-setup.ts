import { startMockBackend } from './mock-backend';

/**
 * Starts the mock gRPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to dial this mock via *_ENDPOINT env vars (CONFIG_ENDPOINT,
 * IDENTITY_ENDPOINT, INGEST_ENDPOINT all set to 127.0.0.1:9093).
 */
export default async function globalSetup() {
  await startMockBackend();
}
