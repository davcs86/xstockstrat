import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for xstockstrat-config-ui (port 3002).
 *
 * globalSetup starts a mock Connect-RPC server on port 9093 before the
 * Next.js dev server, so tests run without real backend services.
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
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3002/config-ui/api/health',
    reuseExistingServer: !process.env.CI,
    env: {
      CONFIG_ENDPOINT: 'http://127.0.0.1:9093',
      IDENTITY_HTTP_ENDPOINT: 'http://127.0.0.1:9093',
      INGEST_HTTP_ENDPOINT: 'http://127.0.0.1:9093',
      JWT_SECRET: 'test-jwt-secret-for-e2e-tests-min32c',
    },
  },
});
