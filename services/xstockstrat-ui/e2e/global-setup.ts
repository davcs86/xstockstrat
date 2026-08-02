import { chromium } from '@playwright/test';
import { startMockBackend } from './mock-backend';

/**
 * Starts the mock gRPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to dial these mocks via *_ENDPOINT env vars set in playwright.config.ts webServer.env.
 */
export default async function globalSetup() {
  // Fail fast if the browser is not launchable — surfaces environment issues
  // in ~2s instead of burning through the 240s webServer timeout. Honor the same
  // `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override the chromium project uses
  // (playwright.config.ts) so the preflight matches how tests actually launch —
  // a no-op in CI, where the env var is unset and the pinned browser build matches.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  try {
    const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
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
