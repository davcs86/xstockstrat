/**
 * Lightweight mock Connect-RPC HTTP server for xstockstrat-insights tests.
 *
 * Port 9092 — pointed at by ANALYSIS_HTTP_ENDPOINT in playwright.config.ts.
 *
 * The /api/analysis/strategies route calls both ListStrategies and then
 * ScoreStrategy for each strategy without an overallScore.  The mock returns
 * strategies with overallScore already set so ScoreStrategy is skipped,
 * keeping test behaviour predictable.
 */
import * as http from 'http';
import { SignJWT } from 'jose';

export const MOCK_PORT = 9092;

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';

let RESPONSES: Record<string, object> = {
  '/xstockstrat.analysis.v1.AnalysisService/ListStrategies': {
    strategies: [
      {
        strategyId: 'strat-high-001',
        name: 'Momentum Alpha',
        description: 'High-conviction momentum strategy',
        rating: 'A',
        overallScore: 0.87,   // 87% — rendered as green (≥80%)
      },
      {
        strategyId: 'strat-mid-002',
        name: 'Mean Reversion',
        description: 'Statistical arbitrage mean reversion',
        rating: 'B',
        overallScore: 0.68,   // 68% — rendered as yellow (60–79%)
      },
      {
        strategyId: 'strat-low-003',
        name: 'Trend Follow',
        description: 'Simple trend following strategy',
        rating: 'D',
        overallScore: 0.42,   // 42% — rendered as red (<60%)
      },
    ],
  },
  // ScoreStrategy is called as fallback when overallScore is missing —
  // return a minimal score so the enrichment branch doesn't error
  '/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy': {
    overallScore: 0.5,
    rating: 'C',
  },
  '/xstockstrat.trading.v1.TradingService/ListBrokerAccounts': {
    accounts: [
      { id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true },
      { id: 'ibkr-001', displayName: 'IBKR Paper', brokerType: 2, isPaper: true, isActive: true },
    ],
  },
  '/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios': {
    portfolios: [
      {
        portfolioId: 'port-001',
        accountId: 'alpaca-default',
        equity: '50000.00',
        cash: '20000.00',
        dayPnl: '150.00',
        dayPnlPct: '0.003',
        totalPnl: '1500.00',
        positions: [],
      },
      {
        portfolioId: 'port-002',
        accountId: 'ibkr-001',
        equity: '30000.00',
        cash: '10000.00',
        dayPnl: '-50.00',
        dayPnlPct: '-0.0017',
        totalPnl: '800.00',
        positions: [],
      },
    ],
  },
};

let server: http.Server | null = null;

export async function startMockBackend(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const testAccessToken = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret);

  const identityPayload = {
    accessToken: testAccessToken,
    refreshToken: 'test-refresh-token',
    claims: { userId: 'test-user-001', email: 'test@example.com', roles: [] },
  };
  RESPONSES['/xstockstrat.identity.v1.IdentityService/AuthenticateUser'] = identityPayload;
  RESPONSES['/xstockstrat.identity.v1.IdentityService/RefreshToken'] = identityPayload;
  RESPONSES['/xstockstrat.identity.v1.IdentityService/RevokeToken'] = { success: true };

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      const body = RESPONSES[path] ?? {};
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(body));
    });

    server.on('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve());
  });
}

export function stopMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
  });
}
