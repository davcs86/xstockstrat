import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for xstockstrat-trader (port 3000).
 *
 * Before each test run:
 *   1. globalSetup starts a lightweight mock Connect-RPC server on port 9091.
 *   2. The Next.js dev server starts with *_HTTP_ENDPOINT env vars pointing at
 *      that mock server so no real backend services are required.
 *   3. globalTeardown stops the mock server.
 *
 * Run:  pnpm test:e2e
 * UI:   pnpm test:e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'html',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use pre-installed chromium when the managed headless-shell is unavailable
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {}),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      // Point all backend clients at the mock server started in globalSetup
      TRADING_HTTP_ENDPOINT: 'http://127.0.0.1:9091',
      PORTFOLIO_HTTP_ENDPOINT: 'http://127.0.0.1:9091',
      NOTIFY_HTTP_ENDPOINT: 'http://127.0.0.1:9091',
      IDENTITY_HTTP_ENDPOINT: 'http://127.0.0.1:9091',
      JWT_SECRET: 'test-jwt-secret-for-e2e-tests-min32c',
    },
  },
});
