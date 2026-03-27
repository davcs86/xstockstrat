import { startMockBackend } from './mock-backend';

/**
 * Starts the mock Connect-RPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to use this mock via *_HTTP_ENDPOINT env vars.
 */
export default async function globalSetup() {
  await startMockBackend();
}
