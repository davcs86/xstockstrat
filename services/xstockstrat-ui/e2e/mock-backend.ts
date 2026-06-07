/**
 * Merged gRPC mock server for xstockstrat-ui E2E tests.
 *
 * Starts three separate http2 servers:
 *   Port 9091 — trader segment: TradingService, PortfolioService, NotifyService,
 *               MarketDataService, IdentityService
 *   Port 9092 — insights segment: AnalysisService, IdentityService, TradingService,
 *               PortfolioService
 *   Port 9093 — config-ui segment: ConfigService, IdentityService, IngestService
 *
 * IDENTITY_ENDPOINT in playwright.config.ts points all segments at 9091 since the
 * IdentityService mock is identical across all three source services.
 */
import * as http2 from 'node:http2';
import { ConnectError, Code } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { SignJWT } from 'jose';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService, type Alert } from '@xstockstrat/proto/notify/v1/notify_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { TEST_JWT_SECRET } from './helpers/auth';

export const TRADER_MOCK_PORT = 9091;
export const INSIGHTS_MOCK_PORT = 9092;
export const CONFIG_UI_MOCK_PORT = 9093;

let traderServer: http2.Http2Server | null = null;
let insightsServer: http2.Http2Server | null = null;
let configUiServer: http2.Http2Server | null = null;

async function makeTestToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret);
}

function stopServer(srv: http2.Http2Server | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!srv) return resolve();
    srv.close((err) => (err ? reject(err) : resolve()));
  });
}

export async function startMockBackend(): Promise<void> {
  const testAccessToken = await makeTestToken();

  const identityHandlers = {
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
  };

  // ── Port 9091 — Trader segment ──────────────────────────────────────────
  const traderHandler = connectNodeAdapter({
    routes(router) {
      router.service(TradingService, {
        async placeOrder() {
          return { orderId: 'mock-order-001', status: 3, tradingMode: 1 };
        },
        async listOrders() {
          return {
            orders: [
              { orderId: 'mock-order-001', symbol: 'AAPL', side: 1, qty: 10, filledQty: 10, filledAvgPrice: 175.50, status: 3, tradingMode: 1 },
              { orderId: 'mock-order-002', symbol: 'TSLA', side: 2, qty: 5, filledQty: 0, filledAvgPrice: 0, status: 1, tradingMode: 1 },
            ],
          };
        },
        async listBrokerAccounts() {
          return {
            accounts: [
              { id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true, credentialStatus: 1 },
              { id: 'ibkr-001', displayName: 'IBKR Paper', brokerType: 2, isPaper: true, isActive: true, credentialStatus: 1 },
            ],
          };
        },
        async registerBrokerAccount() {
          return { account: { id: 'new-account-001', displayName: 'New Account', brokerType: 1, isPaper: true, isActive: true, credentialStatus: 1 } };
        },
        async deregisterBrokerAccount() {
          return {};
        },
        async updateBrokerAccountCredentials() {
          return { account: { id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true, credentialStatus: 1 } };
        },
        async getTradingEnvironment() {
          return { tradingMode: 1, applicationEnv: 'development' };
        },
      });

      router.service(PortfolioService, {
        async getPortfolio() {
          return {
            equity: 52341.89, cash: 18200.00, buyingPower: 36400.00,
            dayPnl: 341.89, dayPnlPct: 0.0066, totalPnl: 2341.89,
            positions: [
              { symbol: 'AAPL', unrealizedPnl: 215.30 },
              { symbol: 'MSFT', unrealizedPnl: -87.40 },
            ],
          };
        },
        async listPortfolios() {
          return {
            portfolios: [
              { portfolioId: 'port-001', accountId: 'alpaca-default', equity: 50000.00, cash: 20000.00, buyingPower: 40000.00, dayPnl: 150.00, dayPnlPct: 0.003, totalPnl: 1500.00, positions: [{ symbol: 'AAPL', unrealizedPnl: 100.00 }] },
            ],
          };
        },
      });

      router.service(NotifyService, {
        async *streamAlerts(): AsyncGenerator<Alert> {
          const alerts: Alert[] = [
            { alertId: 'alert-stream-001', severity: 2, category: 'RISK', title: 'Position limit approaching', body: 'AAPL position is at 80% of max allowed.', sourceService: 'trading' } as Alert,
            { alertId: 'alert-stream-002', severity: 4, category: 'SYSTEM', title: 'Order rejected', body: 'Insufficient buying power for TSLA order.', sourceService: 'trading' } as Alert,
            { alertId: 'alert-stream-003', severity: 1, category: 'TRADE', title: 'Order filled', body: 'AAPL market order for 10 shares filled at $189.80.', sourceService: 'trading' } as Alert,
          ];
          for (const alert of alerts) {
            yield alert;
          }
          // Stream ends cleanly — no hang in tests.
        },
        async listAlerts() {
          return {
            alerts: [
              { alertId: 'alert-001', severity: 2, category: 'RISK', title: 'Position limit approaching', body: 'AAPL position is at 80% of max allowed.', sourceService: 'trading' },
              { alertId: 'alert-002', severity: 4, category: 'SYSTEM', title: 'Order rejected', body: 'Insufficient buying power for TSLA order.', sourceService: 'trading' },
              { alertId: 'alert-strat-001', severity: 1, category: 'strategy', title: 'Entry trigger: Live Test Strategy', body: 'AAPL entry triggered (conviction 0.82)', sourceService: 'xstockstrat-analysis', tags: ['strategy_id:strat-live-001'] },
            ],
          };
        },
      });

      router.service(MarketDataService, {
        async getBars() {
          return {
            bars: [
              { symbol: 'AAPL', open: 188.0, high: 190.5, low: 187.2, close: 189.8, volume: BigInt(45000000), vwap: 189.1, tradeCount: 120000, timeframe: '1Day', source: 'alpaca' },
              { symbol: 'AAPL', open: 189.8, high: 192.0, low: 188.5, close: 191.5, volume: BigInt(38000000), vwap: 190.5, tradeCount: 98000, timeframe: '1Day', source: 'alpaca' },
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

      router.service(IdentityService, identityHandlers);
    },
  });

  await new Promise<void>((resolve, reject) => {
    traderServer = http2.createServer(traderHandler);
    traderServer.on('error', reject);
    traderServer.listen(TRADER_MOCK_PORT, '127.0.0.1', () => resolve());
  });

  // ── Port 9092 — Insights segment ────────────────────────────────────────
  const insightsHandler = connectNodeAdapter({
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
        // Feature 048: trader BFF analysisClient dials ANALYSIS_ENDPOINT (9092 in e2e),
        // so the live-strategy methods are mocked here.
        async listStrategyDefinitions() {
          return {
            definitions: [
              { strategyId: 'strat-live-001', displayName: 'Live Test Strategy', active: true, liveEnabled: true },
              { strategyId: 'strat-live-002', displayName: 'Inactive Strategy', active: true, liveEnabled: false },
            ],
            totalCount: 2,
          };
        },
        async setStrategyLive(req) {
          return {
            definition: { strategyId: req.strategyId, displayName: 'Live Test Strategy', active: true, liveEnabled: req.liveEnabled },
          };
        },
        // Feature 050: strategy-authoring RPCs proxied by the insights BFF.
        async manageStrategy(req) {
          // Sentinel id used by the wizard server-error test (AC-13).
          if (req.definition?.strategyId === 'invalid_ref') {
            throw new ConnectError(
              'component ref_name "missing" used in rule but not declared',
              Code.InvalidArgument,
            );
          }
          return req.definition ?? {};
        },
        async getStrategy(req) {
          return {
            strategyId: req.strategyId,
            displayName: 'Editable Strategy',
            components: [
              { refName: 'sma_fast', kind: 1, indicator: 'SMA', formulaId: '', params: { period: 10 } },
            ],
            entryRule: '{"op":"and","conditions":[]}',
            exitRule: '{"op":"or","conditions":[]}',
            active: true,
            liveEnabled: false,
          };
        },
      });

      router.service(IdentityService, identityHandlers);

      router.service(TradingService, {
        async listBrokerAccounts() {
          return {
            accounts: [
              { id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true },
              { id: 'ibkr-001', displayName: 'IBKR Paper', brokerType: 2, isPaper: true, isActive: true },
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
    },
  });

  await new Promise<void>((resolve, reject) => {
    insightsServer = http2.createServer(insightsHandler);
    insightsServer.on('error', reject);
    insightsServer.listen(INSIGHTS_MOCK_PORT, '127.0.0.1', () => resolve());
  });

  // ── Port 9093 — Config-UI segment ───────────────────────────────────────
  const configUiHandler = connectNodeAdapter({
    routes(router) {
      router.service(ConfigService, {
        async listKeys() {
          return {
            keys: [
              { key: 'platform.log_level', description: 'Global log level for all services', defaultValue: 'info', isSecret: false, consumingService: 'all', environment: 1, tradingMode: 0 },
              { key: 'platform.maintenance_mode', description: 'Halts all trading operations when true', defaultValue: 'false', isSecret: false, consumingService: 'all', environment: 1, tradingMode: 0 },
              { key: 'secret.alpaca_api_key', description: 'Alpaca API key for live trading', defaultValue: '[secret]', isSecret: true, consumingService: 'trading', environment: 2, tradingMode: 2 },
              { key: 'analysis.signals.source_weights', description: 'JSON weight map for signal sources', defaultValue: '{}', isSecret: false, consumingService: 'xstockstrat-analysis', environment: 1, tradingMode: 0, validation: { valueType: 1, minValue: 0.0, maxValue: 1.0 } },
            ],
          };
        },
        async setConfig() {
          return {};
        },
      });

      router.service(IdentityService, identityHandlers);

      router.service(IngestService, {
        async listSignalSources() {
          return {
            sources: [{
              slug: 'example_simple_email',
              displayName: 'Example Simple Email',
              sourceType: 'simple_email',
              extractorModule: 'app.extractors.example_simple_email',
              active: true,
              hasCredentials: true,
              configJson: { sender_patterns: ['noreply@example.com'], subject_patterns: ['Signal:'] },
            }],
          };
        },
        async manageSignalSource() {
          return {
            source: {
              slug: 'example_simple_email',
              displayName: 'Example Simple Email',
              sourceType: 'simple_email',
              extractorModule: 'app.extractors.example_simple_email',
              active: true,
              hasCredentials: true,
              configJson: {},
            },
          };
        },
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    configUiServer = http2.createServer(configUiHandler);
    configUiServer.on('error', reject);
    configUiServer.listen(CONFIG_UI_MOCK_PORT, '127.0.0.1', () => resolve());
  });
}

export async function stopMockBackend(): Promise<void> {
  await Promise.all([
    stopServer(traderServer).finally(() => { traderServer = null; }),
    stopServer(insightsServer).finally(() => { insightsServer = null; }),
    stopServer(configUiServer).finally(() => { configUiServer = null; }),
  ]);
}
