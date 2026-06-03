import { startMockBackend } from './mock-backend';

/**
 * Starts the mock gRPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to dial these mocks via *_ENDPOINT env vars set in playwright.config.ts webServer.env.
 */
export default async function globalSetup() {
  await startMockBackend();
}
