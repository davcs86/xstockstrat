import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import {
  tradingClient,
  portfolioClient,
  marketDataClient,
  notifyClient,
  analysisClient,
  ledgerClient,
  configClient,
} from '@/lib/connectClients';
import {
  createBffRouter,
  createDispatch,
  requireSession,
  backendHeaders,
  forward,
} from '@/lib/bffShared';
import { COPILOT_STREAM_PREFIX, COPILOT_EVENT_TYPE, copilotStreamKey } from '@/lib/copilot';

const router = createBffRouter();

router.service(TradingService, {
  // Ownership comes from the x-user-id header, so these forward unchanged. listOrders keeps an explicit
  // user_id — there it's a cross-user filter (empty = all), which the BFF pins to the session.
  placeOrder: forward((req, opts) => tradingClient.placeOrder(req, opts)),
  async listOrders(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.listOrders(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  getOrder: forward((req, opts) => tradingClient.getOrder(req, opts)),
  cancelOrder: forward((req, opts) => tradingClient.cancelOrder(req, opts)),
  replaceOrder: forward((req, opts) => tradingClient.replaceOrder(req, opts)),
  // The trading service enforces the offline-only + ownership guard server-side from the header.
  confirmOrder: forward((req, opts) => tradingClient.confirmOrder(req, opts)),
  async *streamOrderUpdates(req, ctx) {
    const claims = await requireSession(ctx);
    yield* tradingClient.streamOrderUpdates(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx), signal: ctx.signal },
    );
  },
  listBrokerAccounts: forward((req, opts) => tradingClient.listBrokerAccounts(req, opts)),
  registerBrokerAccount: forward((req, opts) => tradingClient.registerBrokerAccount(req, opts)),
  deregisterBrokerAccount: forward((req, opts) => tradingClient.deregisterBrokerAccount(req, opts)),
  updateBrokerAccountCredentials: forward((req, opts) =>
    tradingClient.updateBrokerAccountCredentials(req, opts),
  ),
  getTradingEnvironment: forward((req, opts) => tradingClient.getTradingEnvironment(req, opts)),
});

router.service(PortfolioService, {
  // Self-scoped reads resolve the caller from the x-user-id header, so they forward unchanged.
  getPortfolio: forward((req, opts) => portfolioClient.getPortfolio(req, opts)),
  listPortfolios: forward((req, opts) => portfolioClient.listPortfolios(req, opts)),
  listPositions: forward((req, opts) => portfolioClient.listPositions(req, opts)),
  getPosition: forward((req, opts) => portfolioClient.getPosition(req, opts)),
});

router.service(MarketDataService, {
  getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
  listAssets: forward((req, opts) => marketDataClient.listAssets(req, opts)),
  // Read-only, ungated (matches GetFundamentals' backend contract).
  getFundamentals: forward((req, opts) => marketDataClient.getFundamentals(req, opts)),
  // Live price wired on both BFFs for cross-surface parity.
  getLatestPrice: forward((req, opts) => marketDataClient.getLatestPrice(req, opts)),
});

router.service(NotifyService, {
  async *streamAlerts(req, ctx) {
    const claims = await requireSession(ctx);
    yield* notifyClient.streamAlerts(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx), signal: ctx.signal },
    );
  },
  listAlerts: forward((req, opts) => notifyClient.listAlerts(req, opts)),
  // Push register/unregister — owner resolved from the x-user-id header, so a browser can't assert
  // another identity (IDOR guard). Unregister is keyed by endpoint only.
  registerPushSubscription: forward((req, opts) =>
    notifyClient.registerPushSubscription(req, opts),
  ),
  unregisterPushSubscription: forward((req, opts) =>
    notifyClient.unregisterPushSubscription(req, opts),
  ),
});

router.service(AnalysisService, {
  listStrategyDefinitions: forward((req, opts) =>
    analysisClient.listStrategyDefinitions(req, opts),
  ),
  // No admin gate — ownership is per-user; analysis resolves the caller from x-user-id and returns
  // PERMISSION_DENIED for a non-owner.
  setStrategyLive: forward((req, opts) => analysisClient.setStrategyLive(req, opts)),
});

router.service(LedgerService, {
  // Copilot reads: the BFF rewrites the client key to the per-user thread server-side, so the
  // browser can only read its own thread (IDOR). Also serves position↔order fill lineage.
  queryEvents: async (req, ctx) => {
    const claims = await requireSession(ctx);
    const streamKey = req.streamKey?.startsWith(COPILOT_STREAM_PREFIX)
      ? copilotStreamKey(claims.user_id)
      : req.streamKey;
    return ledgerClient.queryEvents(
      { ...req, streamKey },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  // Append-only note persistence — stream key/event type/source forced server-side, so the client
  // cannot write outside its own thread.
  appendEvent: async (req, ctx) => {
    const claims = await requireSession(ctx);
    return ledgerClient.appendEvent(
      {
        ...req,
        streamKey: copilotStreamKey(claims.user_id),
        eventType: COPILOT_EVENT_TYPE,
        sourceService: 'xstockstrat-ui',
      },
      { headers: backendHeaders(claims, ctx) },
    );
  },
});

router.service(ConfigService, {
  // Read-only — GetConfig is deliberately open on the backend, no admin gate needed.
  getConfig: forward((req, opts) => configClient.getConfig(req, opts)),
});

// No basePath in the consolidated app — the handler receives the full URL
// /trader/api/<service>/<method>, so the handler map key must include the segment prefix.
export const dispatchConnect = createDispatch(router, '/trader/api');
