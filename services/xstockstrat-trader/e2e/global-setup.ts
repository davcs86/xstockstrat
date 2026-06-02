import { startMockBackend } from './mock-backend';

/**
 * Starts the mock Connect-RPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to dial this mock via `*_ENDPOINT` env vars in `playwright.config.ts` `webServer.env`.
 */
export default async function globalSetup() {
  await startMockBackend();
}
