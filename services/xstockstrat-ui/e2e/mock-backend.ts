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
import { AnalysisService, ReadinessRule } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';
import { NotifyService, type Alert } from '@xstockstrat/proto/notify/v1/notify_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { signTestJwt } from './helpers/auth';
import { HEADER_USER_ID } from '../src/lib/headers';
import {
  TEST_USER_ID,
  TEST_USER_EMAIL,
  BROKER_ACCOUNT_ALPACA,
  BROKER_ACCOUNT_NEW,
  BROKER_ACCOUNTS,
  PORTFOLIO_ALPACA,
  PORTFOLIOS,
  STRATEGY_SCORES,
  STRATEGY_DEF_LIVE,
  STRATEGY_DEFINITIONS,
  insufficientDataResult,
  OPPORTUNITIES,
  symbolReadiness,
  exitReadiness,
  POSITIONS,
  positionForSymbol,
  ORDERS,
  orderForId,
  CONFIG_KEY_FIXTURES,
  SIGNAL_SOURCES,
  SIGNAL_SOURCE_WEIGHTED,
  FUNDAMENTALS_AAPL,
} from './fixtures';
import { criterionDetailRow } from './fixtures/screenResults';
import { backfillJob } from './fixtures/backfillJobs';
import { INDICATOR_SERIES_AAPL } from './fixtures/indicatorSeries';
import { PNL_PATTERNS_AAPL } from './fixtures/pnlPatterns';
import { BackfillStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export const TRADER_MOCK_PORT = 9091;
export const INSIGHTS_MOCK_PORT = 9092;
export const CONFIG_UI_MOCK_PORT = 9093;

// feature 098 — per-symbol readiness bucket overrides for the watchlists rollup e2e. Keyed by
// dedicated symbols the rollup test creates (never AAPL/MSFT/… asserted by other specs), so the
// default `symbolReadiness` (2/3 → "watching") is untouched for every other consumer. Fields spread
// over the fixture in the `evaluateReadiness` handler.
const READINESS_BUCKET_OVERRIDE: Record<
  string,
  { passingConditions?: number; totalConditions?: number }
> = {
  READY1: { passingConditions: 3, totalConditions: 3 }, // ready (firing)
  WATCH1: { passingConditions: 1, totalConditions: 3 }, // watching
  QUIET1: { passingConditions: 0, totalConditions: 3 }, // quiet
  NODATA1: { passingConditions: 0, totalConditions: 0 }, // no-data (un-evaluable)
};

// feature 133 — strategy ownership. Every pre-seeded fixture strategy is owned by user A
// (`TEST_USER_ID`); the composite `(user_id, strategy_id)` PK means a second user (`TEST_USER_B_ID`)
// may hold the same id without collision. The handlers below resolve the caller from the propagated
// `x-user-id` header (never the request body) and mirror the analysis backend's uniform
// PERMISSION_DENIED for a non-owner, so the cross-user isolation e2e proves the BFF forwards
// identity and the backend gates on it.
const A_OWNED_STRATEGY_IDS = new Set<string>([
  ...STRATEGY_DEFINITIONS.map((d) => d.strategyId),
  'strat-owned-by-a', // dedicated ownership-spec fixture
]);

function callerUserId(ctx: { requestHeader: Headers }): string {
  return ctx.requestHeader.get(HEADER_USER_ID) ?? '';
}

function assertStrategyOwner(
  ctx: { requestHeader: Headers },
  strategyId: string | undefined,
): void {
  // A caller who is not the owner of a pre-seeded (user-A) strategy is denied uniformly — no
  // NOT_FOUND vs PERMISSION_DENIED distinction (anti-IDOR, design decision 3). A brand-new id the
  // caller is registering is not in the owned set, so it passes (the caller owns what they create).
  if (strategyId && A_OWNED_STRATEGY_IDS.has(strategyId) && callerUserId(ctx) !== TEST_USER_ID) {
    throw new ConnectError('strategy not found or not owned by caller', Code.PermissionDenied);
  }
}

let traderServer: http2.Http2Server | null = null;
let insightsServer: http2.Http2Server | null = null;
let configUiServer: http2.Http2Server | null = null;

const activeSessions = new Set<http2.Http2Session>();

function trackSessions(srv: http2.Http2Server): void {
  srv.on('session', (session) => {
    activeSessions.add(session);
    session.on('close', () => activeSessions.delete(session));
  });
}

function stopServer(srv: http2.Http2Server | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!srv) return resolve();
    // Destroy persistent h2 sessions (Next.js BFF keeps them alive)
    // so close() resolves immediately instead of waiting for drain.
    for (const session of activeSessions) {
      if (session.socket && !session.socket.destroyed) {
        session.destroy();
      }
    }
    srv.close((err) => (err ? reject(err) : resolve()));
  });
}

export async function startMockBackend(): Promise<void> {
  const testAccessToken = await signTestJwt();

  const identityHandlers = {
    async authenticateUser() {
      return {
        accessToken: testAccessToken,
        refreshToken: 'test-refresh-token',
        claims: { userId: TEST_USER_ID, email: TEST_USER_EMAIL, roles: [] },
      };
    },
    async refreshToken() {
      return {
        accessToken: testAccessToken,
        refreshToken: 'test-refresh-token',
        claims: { userId: TEST_USER_ID, email: TEST_USER_EMAIL, roles: [] },
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
  // placeOrderIntents: an in-memory map keyed by clientOrderId, genuinely exercising
  // dedup (feature 101) rather than just echoing the field back — a repeat call with a
  // clientOrderId already seen in this test run returns the SAME stored response, not a
  // freshly-built one (see docs/roadmap/ledger/insights.md 2026-07-27: "a mock that echoes
  // a request field back as its response cannot distinguish a correct consumer from an
  // incorrect one"). The orderId itself stays the fixed 'mock-order-001' literal that
  // order-form.spec.ts hard-asserts — startMockBackend() runs once for the whole Playwright
  // run (global-setup.ts), so this map is shared/persistent across every spec file and
  // worker; a counter-based id would make that assertion depend on cross-file run order.
  const placeOrderIntents = new Map<
    string,
    { orderId: string; status: number; tradingMode: number; qty: number; stopPrice: number }
  >();
  const traderHandler = connectNodeAdapter({
    routes(router) {
      router.service(TradingService, {
        async placeOrder(req) {
          const clientOrderId = req.clientOrderId;
          const stored = clientOrderId ? placeOrderIntents.get(clientOrderId) : undefined;
          if (stored) {
            return stored;
          }
          // qty/stopPrice (feature 023): a plausible auto-sized order response, so
          // OrderForm's post-submit "qty N, stop N" display (C-14) has something to
          // render — the mock ignores req's own qty/side, per the existing note below.
          const resp = {
            orderId: 'mock-order-001',
            status: 3,
            tradingMode: 1,
            qty: 5,
            stopPrice: 148.25,
          };
          if (clientOrderId) placeOrderIntents.set(clientOrderId, resp);
          return resp;
        },
        async cancelOrder() {
          // Order-ticket page Cancel action (feature 096). Specs that need a specific
          // CancelOrder response still page.route() their own (orders.spec.ts).
          return { success: true };
        },
        async replaceOrder(req) {
          // Order-ticket page Edit → ReplaceOrder (feature 096); echoes the working order back
          // as still NEW so the UI reflects the amendment.
          return { ...orderForId(req.orderId), status: 1 };
        },
        async listOrders(req) {
          // Server-side symbol filter (feature 096): the per-symbol Orders & fills table on the
          // Position page issues ListOrders with a symbol; the unfiltered Orders list omits it.
          const orders = req.symbol ? ORDERS.filter((o) => o.symbol === req.symbol) : ORDERS;
          return { orders };
        },
        async getOrder(req) {
          // Single-order read for the order-ticket page (feature 096).
          return orderForId(req.orderId);
        },
        async listBrokerAccounts() {
          return { accounts: BROKER_ACCOUNTS };
        },
        async registerBrokerAccount() {
          return { account: BROKER_ACCOUNT_NEW };
        },
        async deregisterBrokerAccount() {
          return {};
        },
        async updateBrokerAccountCredentials() {
          return { account: BROKER_ACCOUNT_ALPACA };
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
          // Both accounts so the Book → Portfolio combined view + account cards render (083).
          return { portfolios: PORTFOLIOS };
        },
        async listPositions() {
          // POSITIONS carries the AAPL (factor Tech, stop, flag STOP_NEAR) + MSFT (no risk meta)
          // fixtures. AAPL unrealizedPnl (100.0) matches PORTFOLIO_ALPACA for C-10(b) parity.
          return { positions: POSITIONS, page: { nextPageToken: '' } };
        },
        async getPosition(req) {
          // Single-position read for the dedicated Position page (feature 096); same authoritative
          // fixture as listPositions so the page's unrealized P&L ties to the Exposure list.
          // A symbol not in the fixture set is genuinely unheld → NotFound, mirroring the real
          // PortfolioService.GetPosition (feature 125: the unified page renders its research
          // sections for such symbols instead of a position).
          const held = POSITIONS.find((p) => p.symbol === (req.symbol ?? '').toUpperCase());
          if (!held) {
            throw new ConnectError(`no position for ${req.symbol}`, Code.NotFound);
          }
          return held;
        },
        async listWatchlists() {
          // Default: no watchlists (feature 125 — the unified page's FR-11 gate then renders the
          // Screening branch). Specs needing a watchlisted symbol override this per-test via
          // page.route (see position-detail.spec.ts).
          return { watchlists: [] };
        },
      });

      // In-memory Copilot thread store (feature 083, Step 27) — the BFF rewrites the client
      // key to copilot:<user>:default and forces event_type copilot.message before it reaches
      // this mock, so we key by the resolved stream_key.
      const copilotThreads = new Map<string, { role: string; text: string; sequence: bigint }[]>();

      router.service(LedgerService, {
        async queryEvents(req) {
          if (req.eventType === 'copilot.message' || req.streamKey?.startsWith('copilot:')) {
            const msgs = copilotThreads.get(req.streamKey) ?? [];
            return {
              events: msgs.map((m, i) => ({
                eventId: `copilot-${i}`,
                eventType: 'copilot.message',
                streamKey: req.streamKey,
                sourceService: 'xstockstrat-ui',
                payload: { role: m.role, text: m.text },
                sequence: m.sequence,
              })),
              page: { nextPageToken: '' },
            };
          }
          // feature 102 — reconciliation status for /trader/positions (useReconciliationStatus).
          // Default branch: one healthy tick, no mismatch. Overridden per-test via page.route()
          // for the mismatch/halt scenarios (positions-reconciliation.spec.ts).
          if (req.streamKey?.startsWith('account:')) {
            return {
              events: [
                {
                  eventId: 'evt-reconciliation-001',
                  eventType: 'reconciliation.mismatch_found',
                  streamKey: req.streamKey,
                  sourceService: 'xstockstrat-trading',
                  payload: { mismatch_class: 'quantity_discrepancy', tick_at: Date.now() },
                  sequence: BigInt(1),
                },
              ],
              page: { nextPageToken: '' },
            };
          }
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
        async appendEvent(req) {
          const existing = copilotThreads.get(req.streamKey) ?? [];
          const payload = (req.payload ?? {}) as Record<string, unknown>;
          const sequence = BigInt(existing.length + 1);
          existing.push({
            role: String(payload.role ?? 'user'),
            text: String(payload.text ?? ''),
            sequence,
          });
          copilotThreads.set(req.streamKey, existing);
          return { eventId: `copilot-${existing.length}`, sequence };
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
                // Bar.time (feature 125 FR-6): the Symbol page reads these to build the
                // GetIndicatorSeries request's parity-aligned x-axis.
                time: { seconds: BigInt(1704067200), nanos: 0 }, // 2024-01-01
                open: 188.0,
                high: 190.5,
                low: 187.2,
                close: 189.8,
                volume: BigInt(45000000),
                vwap: 189.1,
                tradeCount: 120000,
                timeframe: '1d',
                timeframeEnum: Timeframe.TIMEFRAME_1DAY,
                source: 'alpaca',
              },
              {
                symbol: 'AAPL',
                time: { seconds: BigInt(1704153600), nanos: 0 }, // 2024-01-02
                open: 189.8,
                high: 192.0,
                low: 188.5,
                close: 191.5,
                volume: BigInt(38000000),
                vwap: 190.5,
                tradeCount: 98000,
                timeframe: '1d',
                timeframeEnum: Timeframe.TIMEFRAME_1DAY,
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
        async getFundamentals(req) {
          // feature 125 (FR-7): AAPL has data; any other symbol has none — the real backend
          // surfaces a no-data miss as UNAVAILABLE (not NotFound), which the UI treats as the
          // explicit no-data state.
          if ((req.symbol ?? '').toUpperCase() === 'AAPL') {
            return { fundamentals: FUNDAMENTALS_AAPL };
          }
          throw new ConnectError(`fmp: no fundamentals for ${req.symbol}`, Code.Unavailable);
        },
      });

      router.service(IdentityService, identityHandlers);
    },
  });

  await new Promise<void>((resolve, reject) => {
    traderServer = http2.createServer(traderHandler);
    trackSessions(traderServer);
    traderServer.on('error', reject);
    traderServer.listen(TRADER_MOCK_PORT, '127.0.0.1', () => resolve());
  });

  // ── Port 9092 — Insights segment ────────────────────────────────────────

  // feature 068: ONE fixture object feeds both listBacktests (summary rows) and
  // getBacktest (full detail) so the two read paths cannot drift (structural C-10(b)
  // parity — the e2e asserts the opened run's metrics equal the row's).
  const HIST_RUN_METRICS = {
    strategyId: 'strat-history-001',
    // bt-hist-2 — the run with persisted detail.
    detailed: {
      backtestId: 'bt-hist-2',
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
      rangeStart: { seconds: BigInt(1704067200), nanos: 0 }, // 2024-01-01
      rangeEnd: { seconds: BigInt(1717200000), nanos: 0 }, // 2024-06-01
    },
    // bt-hist-1 — legacy run, no persisted detail (getBacktest answers NOT_FOUND).
    legacy: {
      backtestId: 'bt-hist-1',
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
  };
  const histDay = (i: number) => ({ seconds: BigInt(1704067200 + i * 86400), nanos: 0 });
  // Full persisted detail for bt-hist-2: same seven metrics as its summary row, plus
  // trades with entry/exit timestamps and per-bar diagnostics carrying equity.
  const HIST_RUN_DETAIL = {
    backtestId: HIST_RUN_METRICS.detailed.backtestId,
    strategyId: HIST_RUN_METRICS.strategyId,
    totalReturn: HIST_RUN_METRICS.detailed.totalReturn,
    annualizedReturn: HIST_RUN_METRICS.detailed.annualizedReturn,
    sharpeRatio: HIST_RUN_METRICS.detailed.sharpeRatio,
    maxDrawdown: HIST_RUN_METRICS.detailed.maxDrawdown,
    winRate: HIST_RUN_METRICS.detailed.winRate,
    totalTrades: HIST_RUN_METRICS.detailed.totalTrades,
    profitFactor: HIST_RUN_METRICS.detailed.profitFactor,
    completedAt: HIST_RUN_METRICS.detailed.completedAt,
    status: 1,
    initialCapital: 100000,
    trades: [
      {
        symbol: 'AAPL',
        side: 'long',
        qty: 100,
        entryPrice: 185.5,
        exitPrice: 192.3,
        pnl: 680,
        entryTime: histDay(1),
        exitTime: histDay(3),
      },
      {
        symbol: 'AAPL',
        side: 'long',
        qty: 100,
        entryPrice: 190.1,
        exitPrice: 188.2,
        pnl: -190,
        entryTime: histDay(4),
        exitTime: histDay(5),
      },
    ],
    diagnostics: [
      {
        symbol: 'AAPL',
        noTradeReason: 0,
        barsTotal: 6,
        warmupBars: 1,
        bars: Array.from({ length: 6 }, (_, i) => ({
          symbol: 'AAPL',
          barIndex: i,
          timestamp: histDay(i),
          open: 185 + i,
          high: 186 + i,
          low: 184 + i,
          close: 185.5 + i,
          volume: BigInt(1000 + i),
          vwap: 185.4 + i,
          warmup: i < 1,
          signalScore: 0.1 * i,
          conviction: 0.2 + 0.1 * i,
          action: i === 1 ? 3 : i === 3 ? 4 : 2, // ENTER_LONG / EXIT_LONG / HOLD_FLAT
          equity: 100000 + i * 150,
        })),
      },
    ],
  };

  const insightsHandler = connectNodeAdapter({
    routes(router) {
      router.service(AnalysisService, {
        async listStrategies(_req, ctx) {
          // feature 133: only the owner (user A) sees the seeded strategies; a different caller
          // gets an empty list (cross-user isolation, AC-3).
          if (callerUserId(ctx) !== TEST_USER_ID) return { strategies: [] };
          return { strategies: STRATEGY_SCORES };
        },
        // feature 083 — ranked opportunity queue; honors the min_conviction filter.
        async listOpportunities(req) {
          const min = req.minConviction ?? 0;
          // feature 132: muted (deny-listed) rows are exempt from the conviction floor (they carry
          // conviction 0 by design) — mirrors the backend `OR provenance ? 'denied'` read exemption.
          return {
            opportunities: OPPORTUNITIES.filter((o) => o.muted || o.conviction >= min),
          };
        },
        // feature 097 — the persisted-disposition RPC exists on the server so a call resolves.
        // Stateful snooze/dismiss *persistence* is proven per-test via page.route isolation
        // (opportunities.spec.ts) — the shared server can't hold per-test state under
        // Playwright fullyParallel without cross-worker pollution (mirrors watchlistMock.ts).
        async setOpportunityAction() {
          return {};
        },
        // feature 083 — traced condition readiness for the Signal-detail panel.
        // feature 098 — per-symbol bucket overrides let the watchlists rollup e2e exercise all four
        // ready/watching/quiet/no-data states. `symbolReadiness` stays single-arg (the `.map` below
        // is an arrow, not point-free, so the array index is never passed as a second argument);
        // overrides are spread at this call site so the shared AAPL default is unchanged.
        async evaluateReadiness(req) {
          // feature 125 — a stale/deleted `?strategy=` param threads a strategyId the analysis
          // service no longer knows; the real EvaluateReadiness aborts NOT_FOUND, and
          // SignalReadiness renders a distinct "no longer exists" message (not the generic error).
          if (req.strategyId === 'strat-notfound-readiness-01') {
            throw new ConnectError(`strategy '${req.strategyId}' not found`, Code.NotFound);
          }
          const syms = req.symbols.length ? req.symbols : ['AAPL'];
          // feature 138 — a held (REDUCE/ADD) opportunity's panel requests the EXIT rule; return
          // the distinct exit trace so the e2e can prove the exit rule was traced (not entry).
          if (req.rule === ReadinessRule.EXIT) {
            return { readiness: syms.map((s) => exitReadiness(s)) };
          }
          return {
            readiness: syms.map((s) => ({
              ...symbolReadiness(s),
              ...(READINESS_BUCKET_OVERRIDE[s] ?? {}),
            })),
          };
        },
        // feature 083 — per-strategy analytics for the Engine → Strategies detail.
        async getStrategyAnalytics(req) {
          return {
            strategyId: req.strategyId,
            expectancy: 0.35,
            blendedHitRate: 0.62,
            maxDrawdown: 0.14,
            signals30d: 42,
            taken: 9,
            queueShare: 0.2,
          };
        },
        async scoreStrategy() {
          return { overallScore: 0.5, rating: 'C' };
        },
        // Feature 053: return a structured INSUFFICIENT_DATA result with a coverage gap so
        // the backtest view renders the gap panel + "backfill this range" action (AC-4).
        async runBacktest(req) {
          if (req.strategyId === 'strat-insufficient-001') {
            // A data-less symbol: RunBacktest returns a *successful* RPC with INSUFFICIENT_DATA and a
            // per-symbol coverage gap (never an error). The symbol page surfaces this inline instead
            // of discarding it (UI-operability pass).
            return {
              backtestId: 'bt-insufficient-1',
              strategyId: req.strategyId,
              status: 2, // BACKTEST_STATUS_INSUFFICIENT_DATA
              totalReturn: 0,
              totalTrades: 0,
              trades: [],
              coverageGaps: [
                {
                  symbol: req.symbols[0] ?? 'ZZZZ',
                  barsHave: BigInt(0),
                  barsNeed: BigInt(200),
                  gap: {
                    start: { seconds: BigInt(1704067200), nanos: 0 }, // 2024-01-01
                    end: { seconds: BigInt(1735603200), nanos: 0 }, // 2024-12-31
                  },
                },
              ],
              diagnostics: [],
            };
          }
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
          if (req.strategyId === 'strat-formula-error-001') {
            // feature 067: a custom-formula component failed to execute — the symbol carries
            // a distinct FORMULA_ERROR reason with no bars, and the banner still renders.
            return {
              backtestId: 'bt-formula-error-1',
              strategyId: req.strategyId,
              status: 1, // BACKTEST_STATUS_OK (a partial run; the banner is bars-independent)
              totalTrades: 0,
              trades: [],
              coverageGaps: [],
              diagnostics: [
                {
                  symbol: req.symbols[0] ?? 'AAPL',
                  barsTotal: 0,
                  warmupBars: 0,
                  noTradeReason: 4, // NO_TRADE_REASON_FORMULA_ERROR
                  bars: [],
                },
              ],
            };
          }
          // feature 071: the gap a windowed run reports is the PRE-window warm-up span, not
          // the requested window — so this honors req.range rather than echoing it back.
          return insufficientDataResult(req.strategyId, req.symbols, req.range);
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
            // Newest first; rows come from the shared 068 fixture (see HIST_RUN_METRICS).
            return {
              runs: [
                { ...HIST_RUN_METRICS.detailed, strategyId: req.strategyId },
                { ...HIST_RUN_METRICS.legacy, strategyId: req.strategyId },
              ],
            };
          }
          return { runs: [] };
        },
        // feature 068: persisted full detail keyed by backtest_id. bt-hist-2 → full result
        // (same metrics as its summary row); bt-hist-1 → NOT_FOUND (legacy/evicted state);
        // anything else → NOT_FOUND.
        async getBacktest(req) {
          if (req.backtestId === HIST_RUN_DETAIL.backtestId) {
            return HIST_RUN_DETAIL;
          }
          throw new ConnectError('no detailed data for this run', Code.NotFound);
        },
        // Feature 060: deterministic ranked screen result — 3 results, score-ordered,
        // one with INSUFFICIENT_DATA + a coverage gap.
        async screenSymbols(req) {
          // feature 125: a single-symbol scan (the Symbol page's Screening section) returns the
          // per-criterion criterionRawValues/criterionPassed maps, never the universe-collapsed
          // composite score. ref_name 'c1' matches SymbolScreening's default first criterion.
          if (req.symbols.length === 1) {
            return {
              results: [criterionDetailRow(req.symbols[0], 42.5, true)],
              coverageGaps: [],
            };
          }
          const symbols = req.symbols.length ? req.symbols : ['AAA', 'BBB', 'CCC'];
          return {
            results: [
              {
                symbol: symbols[0],
                score: 0.91,
                passed: true,
                status: 1,
                criterionScores: { c1: 0.9 },
                // feature 083 raw columns (FR-8).
                pe: 22.5,
                rsi: 58,
                atr: 3.2,
                revGrowth: 0.12,
                held: true,
              },
              {
                symbol: symbols[1] ?? 'BBB',
                score: 0.55,
                passed: true,
                status: 1,
                criterionScores: { c1: 0.5 },
                pe: 15,
                rsi: 45,
                atr: 2.1,
                revGrowth: 0.05,
                held: false,
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
        async listStrategyDefinitions(_req, ctx) {
          // feature 133: definitions are owner-scoped — a non-owner sees none (AC-3).
          if (callerUserId(ctx) !== TEST_USER_ID) {
            return { definitions: [], totalCount: 0 };
          }
          return {
            definitions: STRATEGY_DEFINITIONS,
            totalCount: STRATEGY_DEFINITIONS.length,
          };
        },
        async setStrategyLive(req, ctx) {
          assertStrategyOwner(ctx, req.strategyId); // feature 133 — owner-gated (AC-2)
          return {
            definition: {
              ...STRATEGY_DEF_LIVE,
              strategyId: req.strategyId,
              liveEnabled: req.liveEnabled,
            },
          };
        },
        // Feature 050: strategy-authoring RPCs proxied by the insights BFF.
        async manageStrategy(req, ctx) {
          // feature 133 — a mutation on another user's strategy is denied (AC-2); a brand-new id is
          // owned by the caller and passes.
          assertStrategyOwner(ctx, req.definition?.strategyId);
          // Sentinel id used by the wizard server-error test (AC-13).
          if (req.definition?.strategyId === 'invalid_ref') {
            throw new ConnectError(
              'component ref_name "missing" used in rule but not declared',
              Code.InvalidArgument,
            );
          }
          return req.definition ?? {};
        },
        async getStrategy(req, ctx) {
          assertStrategyOwner(ctx, req.strategyId); // feature 133 — owner-gated read (AC-2)
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
            // Feature 069: only this id carries a non-default cooldown (edit-prepopulation e2e);
            // every other id leaves cooldownDays unset so the "edit unset strategy" case stays honest.
            ...(req.strategyId === 'strat-cooldown-14' ? { cooldownDays: 14 } : {}),
            // feature 132: this id carries a deny list + signal_eligible (deny-list edit round-trip).
            ...(req.strategyId === 'strat-001'
              ? { deniedSymbols: ['TSLA'], signalEligible: true }
              : {}),
            // Feature 116: only this id carries a non-default exit cooldown (edit-prepopulation e2e);
            // every other id leaves exitCooldownDays unset so the "edit unset strategy" case stays honest.
            ...(req.strategyId === 'strat-exit-cooldown-7' ? { exitCooldownDays: 7 } : {}),
            // Feature 097: this id carries a signal_params symbol universe so the wizard's
            // preserve-on-save regression guard (ANALYSIS-3) has real symbols to protect. The id
            // is underscore-only so it passes the wizard's id validation and Next can advance.
            ...(req.strategyId === 'strat_signal_universe'
              ? { signalParams: { symbols: ['AAPL', 'MSFT'] } }
              : {}),
          };
        },
        // feature 125 (FR-6): per-component indicator series for the Symbol page's overlay panels.
        // AAPL → the canonical fixture (a multi-series MACD component with a warm-up gap + a failed
        // component); any other symbol → no components.
        async getIndicatorSeries(req) {
          if (req.symbol === 'AAPL') {
            return INDICATOR_SERIES_AAPL;
          }
          return { times: req.times, components: [] };
        },
        // feature 042 — ranked P&L-attribution factors for the P&L Patterns view.
        async queryPnLPatterns() {
          return PNL_PATTERNS_AAPL;
        },
      });

      router.service(IdentityService, identityHandlers);

      router.service(TradingService, {
        async listBrokerAccounts() {
          return { accounts: BROKER_ACCOUNTS };
        },
      });

      router.service(PortfolioService, {
        async listPortfolios() {
          return { portfolios: PORTFOLIOS };
        },
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    insightsServer = http2.createServer(insightsHandler);
    trackSessions(insightsServer);
    insightsServer.on('error', reject);
    insightsServer.listen(INSIGHTS_MOCK_PORT, '127.0.0.1', () => resolve());
  });

  // ── Port 9093 — Config-UI segment ───────────────────────────────────────
  // configValueOverrides holds any SetConfig writes made during a test, keyed by bare key
  // (CONFIG_KEY_FIXTURES keys are unique across this mock's namespaces), seeded lazily from
  // each row's defaultValue — mirroring value_data vs. default_value on the real service's
  // config.config_values table, so listKeys() reflects a save the same way the real service
  // does (the display-never-updates regression this mock exists to catch).
  const configValueOverrides = new Map<string, string>();

  const configUiHandler = connectNodeAdapter({
    routes(router) {
      router.service(ConfigService, {
        async listKeys() {
          return {
            keys: CONFIG_KEY_FIXTURES.map((k) => ({
              ...k,
              currentValue: configValueOverrides.get(k.key) ?? k.defaultValue,
            })),
          };
        },
        async setConfig(req) {
          const written = req.value?.value?.case === 'stringVal' ? req.value.value.value : '';
          configValueOverrides.set(req.key, written);
          return { version: '1', updatedAt: { seconds: BigInt(0), nanos: 0 } };
        },
        // feature 102 — trader/positions reads platform.trading_state via traderConfigClient
        // (unified across the CONFIG_ENDPOINT port; see playwright.config.ts). Default: ACTIVE
        // (no platform-wide restriction) so the existing suite's happy-path assertions are
        // unaffected. Overridden per-test via page.route() for the REDUCE_ONLY/HALTED cases
        // (positions-reconciliation.spec.ts).
        async getConfig() {
          return {
            namespace: 'platform',
            version: '1',
            values: {
              trading_state: { value: { case: 'stringVal', value: 'ACTIVE' } },
            },
          };
        },
      });

      router.service(IdentityService, identityHandlers);

      router.service(IngestService, {
        async listSignalSources() {
          // feature 134 (C-12): fixtures centralized in e2e/fixtures/signalSources.ts.
          return { sources: SIGNAL_SOURCES };
        },
        // Feature 053: the insights backtest "backfill this range" action dials the insights
        // BFF ingestClient, which (in e2e) points at INGEST_ENDPOINT=9093. Return a deterministic
        // job id so the confirmation can be asserted (AC-4).
        async triggerBackfill() {
          return { jobId: 'job-e2e-1', status: 1 /* BACKFILL_STATUS_QUEUED */ };
        },
        // feature 125: the Symbol-page Backfill coverage section lists jobs for one symbol. AAPL has
        // one COMPLETED job carrying a covered range (2024-01-01 → 2024-06-01); any other symbol has
        // no ingested coverage.
        async listBackfillJobs(req) {
          if (req.symbol === 'AAPL') {
            return {
              jobs: [
                {
                  // Spread the shared fixture, then override the two int64 fields to bigint (the
                  // Connect-server message-init shape) and add the covered range — the fixture's
                  // string int64s are the page.route/Connect-JSON shape backfills.spec.ts needs.
                  ...backfillJob({
                    jobId: 'job-aapl-1',
                    symbols: ['AAPL'],
                    status: BackfillStatus.COMPLETED,
                  }),
                  barsProcessed: BigInt(500),
                  barsTotal: BigInt(500),
                  range: {
                    start: { seconds: BigInt(1704067200), nanos: 0 }, // 2024-01-01
                    end: { seconds: BigInt(1717200000), nanos: 0 }, // 2024-06-01
                  },
                },
              ],
              page: { nextPageToken: '', totalCount: 1 },
            };
          }
          return { jobs: [], page: { nextPageToken: '', totalCount: 0 } };
        },
        async manageSignalSource(req) {
          // feature 134: echo the saved reliabilityWeight back so the inline-edit round-trip is
          // observable (the cell re-reads the mutated value after invalidation).
          return {
            source: {
              ...SIGNAL_SOURCE_WEIGHTED,
              reliabilityWeight:
                req.source?.reliabilityWeight ?? SIGNAL_SOURCE_WEIGHTED.reliabilityWeight,
            },
          };
        },
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    configUiServer = http2.createServer(configUiHandler);
    trackSessions(configUiServer);
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
  activeSessions.clear();
}
