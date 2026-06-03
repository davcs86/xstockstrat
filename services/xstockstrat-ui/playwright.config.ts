import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for xstockstrat-insights (port 3001).
 *
 * globalSetup starts a mock gRPC server (connectNodeAdapter + http2) on port
 * 9092 before the Next.js dev server, so tests run without real backend services.
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
    baseURL: 'http://localhost:3001',
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
    url: 'http://localhost:3001/insights/api/health',
    reuseExistingServer: !process.env.CI,
    env: {
      ANALYSIS_ENDPOINT:   '127.0.0.1:9092',
      MARKETDATA_ENDPOINT: '127.0.0.1:9092',
      IDENTITY_ENDPOINT:   '127.0.0.1:9092',
      TRADING_ENDPOINT:    '127.0.0.1:9092',
      PORTFOLIO_ENDPOINT:  '127.0.0.1:9092',
      JWT_SECRET:          'test-jwt-secret-for-e2e-tests-min32c',
    },
  },
});
