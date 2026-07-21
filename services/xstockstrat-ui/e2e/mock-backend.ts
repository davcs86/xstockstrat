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
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
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
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
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
    // Feature 051 — authorized-apps management. Returns one app (no token/secret fields)
    // so the /accounts page renders a deterministic row through the real BFF→gRPC path.
    async listAuthorizedApps() {
      return {
        apps: [
          {
            clientId: 'oauthc_e2e',
            clientName: 'Claude.ai (E2E)',
            authorizedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
            redirectUris: ['https://claude.ai/cb'],
          },
        ],
      };
    },
    async revokeAuthorizedApp() {
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
              {
                orderId: 'mock-order-001',
                symbol: 'AAPL',
                side: 1,
                qty: 10,
                filledQty: 10,
                filledAvgPrice: 175.5,
                status: 3,
                tradingMode: 1,
              },
              {
                orderId: 'mock-order-002',
                symbol: 'TSLA',
                side: 2,
                qty: 5,
                filledQty: 0,
                filledAvgPrice: 0,
                status: 1,
                tradingMode: 1,
              },
            ],
          };
        },
        async listBrokerAccounts() {
          return {
            accounts: [
              {
                id: 'alpaca-default',
                displayName: 'Alpaca Paper',
                brokerType: 1,
                isPaper: true,
                isActive: true,
                credentialStatus: 1,
              },
              {
                id: 'ibkr-001',
                displayName: 'IBKR Paper',
                brokerType: 2,
                isPaper: true,
                isActive: true,
                credentialStatus: 1,
              },
            ],
          };
        },
        async registerBrokerAccount() {
          return {
            account: {
              id: 'new-account-001',
              displayName: 'New Account',
              brokerType: 1,
              isPaper: true,
              isActive: true,
              credentialStatus: 1,
            },
          };
        },
        async deregisterBrokerAccount() {
          return {};
        },
        async updateBrokerAccountCredentials() {
          return {
            account: {
              id: 'alpaca-default',
              displayName: 'Alpaca Paper',
              brokerType: 1,
              isPaper: true,
              isActive: true,
              credentialStatus: 1,
            },
          };
        },
        async getTradingEnvironment() {
          return { tradingMode: 1, applicationEnv: 'development' };
        },
      });

      router.service(PortfolioService, {
        async getPortfolio() {
          return {
            equity: 52341.89,
            cash: 18200.0,
            buyingPower: 36400.0,
            dayPnl: 341.89,
            dayPnlPct: 0.0066,
            totalPnl: 2341.89,
            positions: [
              { symbol: 'AAPL', unrealizedPnl: 215.3 },
              { symbol: 'MSFT', unrealizedPnl: -87.4 },
            ],
          };
        },
        async listPortfolios() {
          return {
            portfolios: [
              {
                portfolioId: 'port-001',
                accountId: 'alpaca-default',
                equity: 50000.0,
                cash: 20000.0,
                buyingPower: 40000.0,
                dayPnl: 150.0,
                dayPnlPct: 0.003,
                totalPnl: 1500.0,
                positions: [{ symbol: 'AAPL', unrealizedPnl: 100.0 }],
              },
            ],
          };
        },
        async listPositions() {
          return {
            positions: [
              {
                symbol: 'AAPL',
                qty: 10,
                avgEntryPrice: 180.0,
                currentPrice: 189.8,
                marketValue: 1898.0,
                unrealizedPnl: 98.0,
                unrealizedPnlPct: 0.054,
                costBasis: 1800.0,
                accountId: 'alpaca-default',
                tradingMode: 1,
              },
              {
                symbol: 'MSFT',
                qty: -5,
                avgEntryPrice: 420.0,
                currentPrice: 410.0,
                marketValue: -2050.0,
                unrealizedPnl: 50.0,
                unrealizedPnlPct: 0.024,
                costBasis: -2100.0,
                accountId: 'alpaca-default',
                tradingMode: 1,
              },
            ],
            page: { nextPageToken: '' },
          };
        },
      });

      router.service(LedgerService, {
        async queryEvents() {
          return {
            events: [
              {
                eventId: 'evt-001',
                eventType: 'order.filled',
                streamKey: 'order:mock-order-001',
                sourceService: 'trading',
                payload: {
                  order_id: 'mock-order-001',
                  symbol: 'AAPL',
                  qty: 10,
                  fill_price: 180.0,
                  account_id: 'alpaca-default',
                  trading_mode: 'TRADING_MODE_PAPER',
                  user_id: 'test-user-001',
                },
                sequence: BigInt(1),
              },
            ],
            page: { nextPageToken: '' },
          };
        },
      });

      router.service(NotifyService, {
        async *streamAlerts(): AsyncGenerator<Alert> {
          const alerts: Alert[] = [
            {
              alertId: 'alert-stream-001',
              severity: 2,
              category: 'RISK',
              title: 'Position limit approaching',
              body: 'AAPL position is at 80% of max allowed.',
              sourceService: 'trading',
            } as Alert,
            {
              alertId: 'alert-stream-002',
              severity: 4,
              category: 'SYSTEM',
              title: 'Order rejected',
              body: 'Insufficient buying power for TSLA order.',
              sourceService: 'trading',
            } as Alert,
            {
              alertId: 'alert-stream-003',
              severity: 1,
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
                severity: 2,
                category: 'RISK',
                title: 'Position limit approaching',
                body: 'AAPL position is at 80% of max allowed.',
                sourceService: 'trading',
              },
              {
                alertId: 'alert-002',
                severity: 4,
                category: 'SYSTEM',
                title: 'Order rejected',
                body: 'Insufficient buying power for TSLA order.',
                sourceService: 'trading',
              },
              {
                alertId: 'alert-strat-001',
                severity: 1,
                category: 'strategy',
                title: 'Entry trigger: Live Test Strategy',
                body: 'AAPL entry triggered (conviction 0.82)',
                sourceService: 'xstockstrat-analysis',
                tags: ['strategy_id:strat-live-001'],
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
              {
                strategyId: 'strat-high-001',
                name: 'Momentum Alpha',
                description: 'High-conviction momentum strategy',
                rating: 'A',
                overallScore: 0.87,
                // feature 065: well-evidenced grade (above the symbol/day floor → not provisional).
                evidenceSymbols: 8,
                evidenceDays: 2100,
                provisional: false,
              },
              {
                strategyId: 'strat-mid-002',
                name: 'Mean Reversion',
                description: 'Statistical arbitrage mean reversion',
                rating: 'B',
                overallScore: 0.68,
                // feature 065: thin evidence → provisional grade.
                evidenceSymbols: 1,
                evidenceDays: 60,
                provisional: true,
              },
              {
                strategyId: 'strat-low-003',
                name: 'Trend Follow',
                description: 'Simple trend following strategy',
                rating: 'D',
                overallScore: 0.42,
                evidenceSymbols: 4,
                evidenceDays: 900,
                provisional: false,
              },
            ],
          };
        },
        async scoreStrategy() {
          return { overallScore: 0.5, rating: 'C' };
        },
        // Feature 053: return a structured INSUFFICIENT_DATA result with a coverage gap so
        // the backtest view renders the gap panel + "backfill this range" action (AC-4).
        async runBacktest(req) {
          if (req.strategyId === 'strat-diag-001') {
            // feature 064: an OK result carrying per-bar diagnostics + a no-trade reason.
            const sym = req.symbols[0] ?? 'AAPL';
            const bar = (
              i: number,
              close: number,
              indicators: Record<string, number>,
              warmup: boolean,
              action: number,
            ) => ({
              symbol: sym,
              barIndex: i,
              timestamp: { seconds: BigInt(1704067200 + i * 86400), nanos: 0 },
              open: close,
              high: close + 1,
              low: close - 1,
              close,
              volume: BigInt(100 + i),
              vwap: close,
              indicators,
              warmup,
              signalScore: 0,
              conviction: warmup ? 0 : 0.5,
              action,
            });
            return {
              backtestId: 'bt-diag-1',
              strategyId: req.strategyId,
              status: 1, // BACKTEST_STATUS_OK
              totalTrades: 0,
              trades: [],
              coverageGaps: [],
              diagnostics: [
                {
                  symbol: sym,
                  barsTotal: 3,
                  warmupBars: 1,
                  noTradeReason: 2, // NO_TRADE_REASON_ENTRY_NEVER_TRUE
                  bars: [
                    bar(0, 10, {}, true, 1), // WARMUP
                    bar(1, 11, { sma_fast: 10.5 }, false, 2), // HOLD_FLAT
                    bar(2, 12, { sma_fast: 11.5, sma_slow: 11 }, false, 2),
                  ],
                },
              ],
            };
          }
          return {
            backtestId: 'bt-e2e-1',
            strategyId: req.strategyId,
            status: 2, // BACKTEST_STATUS_INSUFFICIENT_DATA
            totalTrades: 0,
            trades: [],
            coverageGaps: [
              {
                symbol: req.symbols[0] ?? 'AAPL',
                timeframe: 4, // TIMEFRAME_1DAY
                requestedRange: req.range,
                barsHave: BigInt(3),
                barsNeed: BigInt(52),
                gap: req.range,
              },
            ],
          };
        },
        async getStrategyReport(req) {
          // feature 065: a strategy whose grade was cleared (never earned / definition changed)
          // answers NOT_FOUND — the detail page renders the cleared-grade empty state.
          if (req.strategyId === 'strat-notfound-001') {
            throw new ConnectError('no eligible evidence', Code.NotFound);
          }
          if (req.strategyId === 'strat-history-001') {
            // A strategy with a persisted, derived score (run-history rows come from ListBacktests).
            return {
              strategyId: req.strategyId,
              score: {
                strategyId: req.strategyId,
                overallScore: 0.72,
                rating: 'B',
                componentScores: { sharpe: 0.75, drawdown: 0.7, win_rate: 0.6 },
                // feature 065: evidence provenance behind the derived headline grade.
                evidenceSymbols: 8,
                evidenceDays: 2100,
                provisional: false,
              },
            };
          }
          // No prior backtest — the page falls back to the run-backtest flow above.
          return { strategyId: req.strategyId };
        },
        async listBacktests(req) {
          if (req.strategyId === 'strat-history-001') {
            return {
              runs: [
                {
                  backtestId: 'bt-hist-2',
                  strategyId: req.strategyId,
                  status: 1, // BACKTEST_STATUS_OK
                  totalReturn: 0.15,
                  annualizedReturn: 0.12,
                  sharpeRatio: 1.6,
                  maxDrawdown: 0.08,
                  winRate: 0.62,
                  totalTrades: 5,
                  profitFactor: 1.4,
                  symbols: ['AAPL'],
                  overallScore: 0.72,
                  rating: 'B',
                  completedAt: { seconds: BigInt(1717286400), nanos: 0 }, // 2024-06-02
                  // feature 065: this run carries a range window (rendered in the Range column).
                  rangeStart: { seconds: BigInt(1704067200), nanos: 0 }, // 2024-01-01
                  rangeEnd: { seconds: BigInt(1717200000), nanos: 0 }, // 2024-06-01
                },
                {
                  backtestId: 'bt-hist-1',
                  strategyId: req.strategyId,
                  status: 1,
                  totalReturn: -0.03,
                  annualizedReturn: -0.02,
                  sharpeRatio: 0.4,
                  maxDrawdown: 0.2,
                  winRate: 0.45,
                  totalTrades: 3,
                  profitFactor: 0.9,
                  symbols: ['MSFT'],
                  overallScore: 0.41,
                  rating: 'D',
                  completedAt: { seconds: BigInt(1717200000), nanos: 0 }, // 2024-06-01
                },
              ],
            };
          }
          return { runs: [] };
        },
        // Feature 060: deterministic ranked screen result — 3 results, score-ordered,
        // one with INSUFFICIENT_DATA + a coverage gap.
        async screenSymbols(req) {
          const symbols = req.symbols.length ? req.symbols : ['AAA', 'BBB', 'CCC'];
          return {
            results: [
              {
                symbol: symbols[0],
                score: 0.91,
                passed: true,
                status: 1,
                criterionScores: { c1: 0.9 },
              },
              {
                symbol: symbols[1] ?? 'BBB',
                score: 0.55,
                passed: true,
                status: 1,
                criterionScores: { c1: 0.5 },
              },
              {
                symbol: symbols[2] ?? 'CCC',
                score: 0,
                passed: false,
                status: 2, // SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
                gap: {
                  symbol: symbols[2] ?? 'CCC',
                  timeframe: 4,
                  barsHave: BigInt(0),
                  barsNeed: BigInt(2),
                },
              },
            ],
            coverageGaps: [],
          };
        },
        // Feature 048: trader BFF analysisClient dials ANALYSIS_ENDPOINT (9092 in e2e),
        // so the live-strategy methods are mocked here.
        async listStrategyDefinitions() {
          return {
            definitions: [
              {
                strategyId: 'strat-live-001',
                displayName: 'Live Test Strategy',
                active: true,
                liveEnabled: true,
              },
              {
                strategyId: 'strat-live-002',
                displayName: 'Inactive Strategy',
                active: true,
                liveEnabled: false,
              },
            ],
            totalCount: 2,
          };
        },
        async setStrategyLive(req) {
          return {
            definition: {
              strategyId: req.strategyId,
              displayName: 'Live Test Strategy',
              active: true,
              liveEnabled: req.liveEnabled,
            },
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
              {
                refName: 'sma_fast',
                kind: 1,
                indicator: 'SMA',
                formulaId: '',
                params: { period: 10 },
              },
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
              {
                id: 'alpaca-default',
                displayName: 'Alpaca Paper',
                brokerType: 1,
                isPaper: true,
                isActive: true,
              },
              {
                id: 'ibkr-001',
                displayName: 'IBKR Paper',
                brokerType: 2,
                isPaper: true,
                isActive: true,
              },
            ],
          };
        },
      });

      router.service(PortfolioService, {
        async listPortfolios() {
          return {
            portfolios: [
              {
                portfolioId: 'port-001',
                accountId: 'alpaca-default',
                equity: 50000,
                cash: 20000,
                dayPnl: 150,
                dayPnlPct: 0.003,
                totalPnl: 1500,
                positions: [],
              },
              {
                portfolioId: 'port-002',
                accountId: 'ibkr-001',
                equity: 30000,
                cash: 10000,
                dayPnl: -50,
                dayPnlPct: -0.0017,
                totalPnl: 800,
                positions: [],
              },
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
              {
                key: 'platform.log_level',
                description: 'Global log level for all services',
                defaultValue: 'info',
                isSecret: false,
                consumingService: 'all',
                environment: 1,
                tradingMode: 0,
              },
              {
                key: 'platform.maintenance_mode',
                description: 'Halts all trading operations when true',
                defaultValue: 'false',
                isSecret: false,
                consumingService: 'all',
                environment: 1,
                tradingMode: 0,
              },
              {
                key: 'secret.alpaca_api_key',
                description: 'Alpaca API key for live trading',
                defaultValue: '[secret]',
                isSecret: true,
                consumingService: 'trading',
                environment: 2,
                tradingMode: 2,
              },
              {
                key: 'analysis.signals.source_weights',
                description: 'JSON weight map for signal sources',
                defaultValue: '{}',
                isSecret: false,
                consumingService: 'xstockstrat-analysis',
                environment: 1,
                tradingMode: 0,
                validation: { valueType: 1, minValue: 0.0, maxValue: 1.0 },
              },
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
            sources: [
              {
                slug: 'example_simple_email',
                displayName: 'Example Simple Email',
                sourceType: 'simple_email',
                extractorModule: 'app.extractors.example_simple_email',
                active: true,
                hasCredentials: true,
                configJson: {
                  sender_patterns: ['noreply@example.com'],
                  subject_patterns: ['Signal:'],
                },
              },
            ],
          };
        },
        // Feature 053: the insights backtest "backfill this range" action dials the insights
        // BFF ingestClient, which (in e2e) points at INGEST_ENDPOINT=9093. Return a deterministic
        // job id so the confirmation can be asserted (AC-4).
        async triggerBackfill() {
          return { jobId: 'job-e2e-1', status: 1 /* BACKFILL_STATUS_QUEUED */ };
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
    stopServer(traderServer).finally(() => {
      traderServer = null;
    }),
    stopServer(insightsServer).finally(() => {
      insightsServer = null;
    }),
    stopServer(configUiServer).finally(() => {
      configUiServer = null;
    }),
  ]);
}
