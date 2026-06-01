/**
 * gRPC mock server for xstockstrat-insights E2E tests.
 *
 * Uses connectNodeAdapter + http2.createServer to serve real gRPC/H2C so the
 * production connectClients.ts (createGrpcTransport) needs no test-specific
 * overrides.  All mock endpoints are registered via router.service() so the
 * binary-proto serialization is handled by the connect-node runtime.
 *
 * Port 9092 — pointed at by ANALYSIS_ENDPOINT and IDENTITY_ENDPOINT in
 * playwright.config.ts.
 */
import * as http2 from 'node:http2';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { SignJWT } from 'jose';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

export const MOCK_PORT = 9092;

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';

let server: http2.Http2Server | null = null;

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

  const handler = connectNodeAdapter({
    routes(router) {
      router.service(AnalysisService, {
        async listStrategies() {
          return {
            strategies: [
              { strategyId: 'strat-high-001', name: 'Momentum Alpha', description: 'High-conviction momentum strategy', rating: 'A', overallScore: 0.87 },
              { strategyId: 'strat-mid-002', name: 'Mean Reversion', description: 'Statistical arbitrage mean reversion', rating: 'B', overallScore: 0.68 },
              { strategyId: 'strat-low-003', name: 'Trend Follow', description: 'Simple trend following strategy', rating: 'D', overallScore: 0.42 },
            ],
          };
        },
        async scoreStrategy() {
          return { overallScore: 0.5, rating: 'C' };
        },
        async runBacktest() {
          return {
            backtestId: 'bt-001',
            strategyId: 'strat-high-001',
            totalReturn: 0.15,
            totalTrades: 2,
            trades: [
              { symbol: 'AAPL', side: 'BUY', qty: 10, entryPrice: 180.0, exitPrice: 195.0, pnl: 150.0 },
              { symbol: 'AAPL', side: 'SELL', qty: 10, entryPrice: 195.0, exitPrice: 190.0, pnl: -50.0 },
            ],
          };
        },
        async getStrategyReport() {
          return { strategyId: 'strat-high-001' };
        },
      });

      router.service(IdentityService, {
        async authenticateUser() {
          return {
            accessToken: testAccessToken,
            refreshToken: 'test-refresh-token',
            claims: { userId: 'test-user-001', email: 'test@example.com', roles: [] },
          };
        },
        async refreshToken() {
          return {
            accessToken: testAccessToken,
            refreshToken: 'test-refresh-token',
            claims: { userId: 'test-user-001', email: 'test@example.com', roles: [] },
          };
        },
        async revokeToken() {
          return { success: true };
        },
      });

      router.service(TradingService, {
        async listBrokerAccounts() {
          return {
            accounts: [
              { accountId: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true },
              { accountId: 'ibkr-001', displayName: 'IBKR Paper', brokerType: 2, isPaper: true, isActive: true },
            ],
          };
        },
      });

      router.service(PortfolioService, {
        async listPortfolios() {
          return {
            portfolios: [
              { portfolioId: 'port-001', accountId: 'alpaca-default', equity: 50000, cash: 20000, dayPnl: 150, dayPnlPct: 0.003, totalPnl: 1500, positions: [] },
              { portfolioId: 'port-002', accountId: 'ibkr-001', equity: 30000, cash: 10000, dayPnl: -50, dayPnlPct: -0.0017, totalPnl: 800, positions: [] },
            ],
          };
        },
      });

      router.service(MarketDataService, {
        async getBars() {
          return {
            bars: [
              { symbol: 'AAPL', open: 188.0, high: 190.5, low: 187.2, close: 189.8,
                volume: BigInt(45000000), vwap: 189.1, tradeCount: 120000,
                timeframe: '1Day', source: 'alpaca' },
              { symbol: 'AAPL', open: 189.8, high: 192.0, low: 188.5, close: 191.5,
                volume: BigInt(38000000), vwap: 190.5, tradeCount: 98000,
                timeframe: '1Day', source: 'alpaca' },
            ],
          };
        },
      });
    },
  });

  return new Promise((resolve, reject) => {
    server = http2.createServer(handler);
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
