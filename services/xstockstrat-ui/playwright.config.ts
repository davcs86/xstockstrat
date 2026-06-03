import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for xstockstrat-ui (port 3000).
 *
 * globalSetup starts three mock gRPC servers (connectNodeAdapter + http2) on
 * ports 9091/9092/9093 before the Next.js dev server, so tests run without
 * real backend services. Each segment uses the mock on its designated port.
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
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {}),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/trader/api/health',
    reuseExistingServer: !process.env.CI,
    env: {
      TRADING_ENDPOINT: '127.0.0.1:9091',
      PORTFOLIO_ENDPOINT: '127.0.0.1:9091',
      NOTIFY_ENDPOINT: '127.0.0.1:9091',
      IDENTITY_ENDPOINT: '127.0.0.1:9091',
      MARKETDATA_ENDPOINT: '127.0.0.1:9091',
      ANALYSIS_ENDPOINT: '127.0.0.1:9092',
      INDICATORS_ENDPOINT: '127.0.0.1:9092',
      CONFIG_ENDPOINT: '127.0.0.1:9093',
      INGEST_ENDPOINT: '127.0.0.1:9093',
      JWT_SECRET: 'test-jwt-secret-for-e2e-tests-min32c',
    },
  },
});
