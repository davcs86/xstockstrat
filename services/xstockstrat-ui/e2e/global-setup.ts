import { chromium } from '@playwright/test';
import { startMockBackend } from './mock-backend';

/**
 * Starts the mock gRPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to dial these mocks via *_ENDPOINT env vars set in playwright.config.ts webServer.env.
 */
export default async function globalSetup() {
  // Fail fast if the browser is not launchable — surfaces environment issues
  // in ~2s instead of burning through the 240s webServer timeout.
  try {
    const browser = await chromium.launch();
    await browser.close();
  } catch (err) {
    console.error(
      '\n[E2E PREFLIGHT] Cannot launch Chromium. Check PLAYWRIGHT_BROWSERS_PATH ' +
        'and PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.\n',
      err,
    );
    throw err;
  }

  await startMockBackend();
}
