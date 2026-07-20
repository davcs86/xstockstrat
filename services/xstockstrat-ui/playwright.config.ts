import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const isCI = !!process.env.CI;

/**
 * Browser resolution for environments that pre-bake browsers and block downloads.
 *
 * Some managed/sandbox environments set PLAYWRIGHT_BROWSERS_PATH to a directory that
 * already contains a *single* browser build and set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1,
 * so `playwright install` can't fetch anything. That pre-baked build often does NOT match
 * the one this exact @playwright/test version manages, which makes Playwright's default
 * launch fail (e.g. chromium looks for a missing `chrome-headless-shell-<rev>`, and Firefox
 * may be absent entirely).
 *
 * To stay robust we:
 *   - point chromium's `launchOptions.executablePath` at the pre-installed full Chromium
 *     (which also sidesteps the separate headless-shell binary), and
 *   - drop the Firefox project when no Firefox build is pre-installed,
 * so the suite runs on whatever is actually present instead of erroring at launch.
 *
 * When PLAYWRIGHT_BROWSERS_PATH is unset (normal CI — see ci.yml `frontend-e2e`, which
 * installs matching browsers into the default ~/.cache/ms-playwright — and local dev),
 * none of this triggers and Playwright uses its own managed browsers exactly as before.
 *
 * IMPORTANT: the override must be set under `use.launchOptions.executablePath`. A top-level
 * `use.executablePath` is NOT a recognized option and is silently ignored.
 */
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

// Per-browser relative path from a `<name>-<rev>` install dir to its launch binary.
const BROWSER_BINARY: Record<'chromium' | 'firefox', string> = {
  chromium: path.join('chrome-linux', 'chrome'),
  firefox: path.join('firefox', 'firefox'),
};

/** Resolve a pre-installed browser binary under PLAYWRIGHT_BROWSERS_PATH, or undefined. */
function preinstalledBrowser(name: 'chromium' | 'firefox'): string | undefined {
  if (!browsersPath || !existsSync(browsersPath)) return undefined;
  // Stable unversioned symlink some sandboxes expose (e.g. `<path>/chromium` → …/chrome).
  const stable = path.join(browsersPath, name);
  if (existsSync(stable) && !statSync(stable).isDirectory()) return stable;
  // Otherwise pick the highest `<name>-<rev>` build that has its launch binary.
  const revs = readdirSync(browsersPath)
    .filter((d) => new RegExp(`^${name}-\\d+$`).test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of revs) {
    const bin = path.join(browsersPath, dir, BROWSER_BINARY[name]);
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

const overridePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// Explicit override always wins; otherwise auto-detect a pre-installed Chromium.
const chromiumExecutable =
  (overridePath && existsSync(overridePath) ? overridePath : undefined) ??
  preinstalledBrowser('chromium');

const firefoxExecutable = preinstalledBrowser('firefox');
// Include Firefox unless PLAYWRIGHT_BROWSERS_PATH is set but ships no Firefox build.
const includeFirefox = !browsersPath || firefoxExecutable !== undefined;

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
        // Use a pre-installed Chromium when present (managed sandboxes). Must go under
        // launchOptions — a top-level `executablePath` in `use` is silently ignored.
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    ...(includeFirefox
      ? [
          {
            name: 'firefox',
            use: {
              ...devices['Desktop Firefox'],
              ...(firefoxExecutable
                ? { launchOptions: { executablePath: firefoxExecutable } }
                : {}),
            },
          },
        ]
      : []),
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
      TRADING_ENDPOINT: '127.0.0.1:9091',
      PORTFOLIO_ENDPOINT: '127.0.0.1:9091',
      LEDGER_ENDPOINT: '127.0.0.1:9091',
      MARKETDATA_ENDPOINT: '127.0.0.1:9091',
      NOTIFY_ENDPOINT: '127.0.0.1:9091',
      IDENTITY_ENDPOINT: '127.0.0.1:9091',
      // insights segment: AnalysisService is mocked on port 9092
      ANALYSIS_ENDPOINT: '127.0.0.1:9092',
      // config-ui segment: ConfigService + IngestService are mocked on port 9093
      CONFIG_ENDPOINT: '127.0.0.1:9093',
      INGEST_ENDPOINT: '127.0.0.1:9093',
      JWT_SECRET: 'test-jwt-secret-for-e2e-tests-min32c',
      // Feature 051 — the /accounts layout reads AGENT_PUBLIC_URL server-side to render the
      // connector URL + drive the agent-health probe. Point at a dead port so the probe is
      // deterministically "unreachable" unless a test overrides /accounts/api/agent-health.
      AGENT_PUBLIC_URL: 'http://127.0.0.1:9099',
      // Build a regular (non-standalone) bundle so `next start` can serve it.
      NEXT_DISABLE_STANDALONE: '1',
    },
  },
});
