import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

/**
 * Playwright configuration for xstockstrat-ui (port 3000).
 *
 * globalSetup starts a mock gRPC server (connectNodeAdapter + http2) on ports
 * 9091/9092/9093 before the Next.js web server, so tests run without real
 * backend services.
 *
 * De-flaking notes (CI):
 *   - `pnpm dev` compiles each route on its FIRST hit; under CI load that first
 *     navigation can take >5s and time out the first assertion after
 *     `page.goto()` (several assertions in the specs hard-code a 5s timeout, so
 *     the unminified dev bundle is the actual flake source). In CI we therefore
 *     build once and serve a PRODUCTION bundle (`pnpm build && pnpm start`):
 *     no on-demand compilation, minified client JS, fast and stable first hits.
 *     `NEXT_DISABLE_STANDALONE` makes that build a regular bundle so `next start`
 *     can serve it (`next start` is unsupported with output:'standalone', which
 *     production/Docker keeps — see next.config.js / Dockerfile).
 *   - CI `timeout`/`expect.timeout` are still widened as a safety margin.
 *   - `maxFailures: 0` so a single flaky test never aborts the whole suite
 *     ("N did not run"); flakes are absorbed by `retries` instead. (The old
 *     `maxFailures: 1` failed the entire job on one cold-start timeout.)
 *   - Locally we keep `pnpm dev` (with reuseExistingServer) for fast iteration.
 *
 * Run:  pnpm test:e2e
 * UI:   pnpm test:e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  maxFailures: 0,
  timeout: isCI ? 30_000 : 10_000,
  expect: { timeout: isCI ? 15_000 : 5_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'html',
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
    command: isCI ? 'pnpm build && pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000/insights/api/health',
    reuseExistingServer: !isCI,
    // CI runs a full `next build` first — give it ample headroom (default 60s).
    timeout: isCI ? 240_000 : 60_000,
    env: {
      // Trader-segment backends (full TradingService/PortfolioService/
      // MarketDataService/NotifyService) live on the 9091 mock. The 9092 mock
      // only implements the insights subset (ListBrokerAccounts/ListPortfolios),
      // so trader BFF calls (ListOrders, PlaceOrder, GetPortfolio, GetBars,
      // ListAssets, StreamAlerts) must dial 9091 or they return 501. Insights
      // tests that need broker/portfolio data stub it via page.route, so they
      // are unaffected by this routing.
      TRADING_ENDPOINT:    '127.0.0.1:9091',
      PORTFOLIO_ENDPOINT:  '127.0.0.1:9091',
      MARKETDATA_ENDPOINT: '127.0.0.1:9091',
      NOTIFY_ENDPOINT:     '127.0.0.1:9091',
      IDENTITY_ENDPOINT:   '127.0.0.1:9091',
      // insights segment: AnalysisService is mocked on port 9092
      ANALYSIS_ENDPOINT:   '127.0.0.1:9092',
      // config-ui segment: ConfigService + IngestService are mocked on port 9093
      CONFIG_ENDPOINT:     '127.0.0.1:9093',
      INGEST_ENDPOINT:     '127.0.0.1:9093',
      JWT_SECRET:          'test-jwt-secret-for-e2e-tests-min32c',
      // Feature 051 — the /accounts layout reads AGENT_PUBLIC_URL server-side to render the
      // connector URL + drive the agent-health probe. Point at a dead port so the probe is
      // deterministically "unreachable" unless a test overrides /accounts/api/agent-health.
      AGENT_PUBLIC_URL:    'http://127.0.0.1:9099',
      // Build a regular (non-standalone) bundle so `next start` can serve it.
      NEXT_DISABLE_STANDALONE: '1',
    },
  },
});
