/**
 * gRPC mock server for xstockstrat-trader E2E tests.
 *
 * Uses connectNodeAdapter + http2.createServer to serve real gRPC/H2C so the
 * production connectClients.ts (createGrpcTransport) needs no test-specific
 * overrides.  All mock endpoints are registered via router.service() so the
 * binary-proto serialization is handled by the connect-node runtime.
 *
 * Port 9091 — pointed at by TRADING_ENDPOINT, PORTFOLIO_ENDPOINT,
 * NOTIFY_ENDPOINT, IDENTITY_ENDPOINT, and MARKETDATA_ENDPOINT in
 * playwright.config.ts.
 */
import * as http2 from 'node:http2';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { SignJWT } from 'jose';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService, type Alert } from '@xstockstrat/proto/notify/v1/notify_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

export const MOCK_PORT = 9091;

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
      router.service(TradingService, {
        async placeOrder() {
          return {
            orderId: 'mock-order-001',
            status: 3,       // ORDER_STATUS_FILLED
            tradingMode: 1,  // TRADING_MODE_PAPER
          };
        },
        async listOrders() {
          return {
            orders: [
              {
                orderId: 'mock-order-001',
                symbol: 'AAPL',
                side: 1,             // ORDER_SIDE_BUY
                qty: 10,
                filledQty: 10,
                filledAvgPrice: 175.50,
                status: 3,           // ORDER_STATUS_FILLED
                tradingMode: 1,      // TRADING_MODE_PAPER
              },
              {
                orderId: 'mock-order-002',
                symbol: 'TSLA',
                side: 2,             // ORDER_SIDE_SELL
                qty: 5,
                filledQty: 0,
                filledAvgPrice: 0,
                status: 1,           // ORDER_STATUS_NEW
                tradingMode: 1,
              },
            ],
          };
        },
        async listBrokerAccounts() {
          return {
            accounts: [
              { id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true },
              { id: 'ibkr-001', displayName: 'IBKR Paper', brokerType: 2, isPaper: true, isActive: true },
            ],
          };
        },
        async registerBrokerAccount() {
          return {
            account: { id: 'new-account-001', displayName: 'New Account', brokerType: 1, isPaper: true, isActive: true },
          };
        },
        async deregisterBrokerAccount() {
          return {};
        },
      });

      router.service(PortfolioService, {
        async getPortfolio() {
          return {
            equity: 52341.89,
            cash: 18200.00,
            buyingPower: 36400.00,
            dayPnl: 341.89,
            dayPnlPct: 0.0066,
            totalPnl: 2341.89,
            positions: [
              { symbol: 'AAPL', unrealizedPnl: 215.30 },
              { symbol: 'MSFT', unrealizedPnl: -87.40 },
            ],
          };
        },
        async listPortfolios() {
          return {
            portfolios: [
              {
                portfolioId: 'port-001',
                accountId: 'alpaca-default',
                equity: 50000.00,
                cash: 20000.00,
                buyingPower: 40000.00,
                dayPnl: 150.00,
                dayPnlPct: 0.003,
                totalPnl: 1500.00,
                positions: [{ symbol: 'AAPL', unrealizedPnl: 100.00 }],
              },
            ],
          };
        },
      });

      router.service(NotifyService, {
        async *streamAlerts(): AsyncGenerator<Alert> {
          const alerts: Alert[] = [
            {
              alertId: 'alert-stream-001',
              severity: 2,           // ALERT_SEVERITY_WARNING
              category: 'RISK',
              title: 'Position limit approaching',
              body: 'AAPL position is at 80% of max allowed.',
              sourceService: 'trading',
            } as Alert,
            {
              alertId: 'alert-stream-002',
              severity: 4,           // ALERT_SEVERITY_CRITICAL
              category: 'SYSTEM',
              title: 'Order rejected',
              body: 'Insufficient buying power for TSLA order.',
              sourceService: 'trading',
            } as Alert,
            {
              alertId: 'alert-stream-003',
              severity: 1,           // ALERT_SEVERITY_INFO
              category: 'TRADE',
              title: 'Order filled',
              body: 'AAPL market order for 10 shares filled at $189.80.',
              sourceService: 'trading',
            } as Alert,
          ];
          for (const alert of alerts) {
            yield alert;
          }
          // Stream ends cleanly — no hang in tests.
        },
        async listAlerts() {
          return {
            alerts: [
              {
                alertId: 'alert-001',
                severity: 2,           // ALERT_SEVERITY_WARNING
                category: 'RISK',
                title: 'Position limit approaching',
                body: 'AAPL position is at 80% of max allowed.',
                sourceService: 'trading',
              },
              {
                alertId: 'alert-002',
                severity: 4,           // ALERT_SEVERITY_CRITICAL
                category: 'SYSTEM',
                title: 'Order rejected',
                body: 'Insufficient buying power for TSLA order.',
                sourceService: 'trading',
              },
            ],
          };
        },
      });

      router.service(MarketDataService, {
        async getBars() {
          return {
            bars: [
              {
                symbol: 'AAPL',
                open: 188.0,
                high: 190.5,
                low: 187.2,
                close: 189.8,
                volume: BigInt(45000000),
                vwap: 189.1,
                tradeCount: 120000,
                timeframe: '1Day',
                source: 'alpaca',
              },
              {
                symbol: 'AAPL',
                open: 189.8,
                high: 192.0,
                low: 188.5,
                close: 191.5,
                volume: BigInt(38000000),
                vwap: 190.5,
                tradeCount: 98000,
                timeframe: '1Day',
                source: 'alpaca',
              },
            ],
          };
        },
        async listAssets() {
          return {
            assets: [
              { symbol: 'AAPL', exchange: 'NASDAQ', assetClass: 'us_equity' },
              { symbol: 'MSFT', exchange: 'NASDAQ', assetClass: 'us_equity' },
              { symbol: 'TSLA', exchange: 'NASDAQ', assetClass: 'us_equity' },
            ],
          };
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
