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
  // Ownership comes from the propagated x-user-id header (backendHeaders) — the trading service
  // resolves the caller from it and the request-body user_id is deprecated, so these forward the
  // request unchanged. listOrders keeps its explicit user_id because there it is a cross-user
  // filter (empty = all users), not the caller's own identity — the BFF pins it to the session.
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
  // The trading service enforces the offline-only + ownership guard server-side from the header
  // (feature 157).
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
  // These self-scoped reads resolve the caller from the propagated x-user-id header
  // (backendHeaders); the request-body user_id is deprecated, so they forward the request
  // unchanged, matching listPortfolios (which never carried a body user_id).
  getPortfolio: forward((req, opts) => portfolioClient.getPortfolio(req, opts)),
  listPortfolios: forward((req, opts) => portfolioClient.listPortfolios(req, opts)),
  listPositions: forward((req, opts) => portfolioClient.listPositions(req, opts)),
  getPosition: forward((req, opts) => portfolioClient.getPosition(req, opts)),
});

router.service(MarketDataService, {
  getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
  listAssets: forward((req, opts) => marketDataClient.listAssets(req, opts)),
  // feature 125 (FR-7) — read-only, ungated (matches GetFundamentals' backend contract); the one
  // genuinely new BFF registration this feature needs (absent from both trader and insights BFFs).
  getFundamentals: forward((req, opts) => marketDataClient.getFundamentals(req, opts)),
  // feature 095 — Decide-surface live price for the off-queue Signal-detail fallback (AC-13);
  // wired on both BFFs for cross-surface parity (C-10(b)).
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
  // Push subscription register/unregister (feature 165). The subscription owner is resolved by the
  // notify service from the propagated x-user-id header (backendHeaders, applied by forward) — the
  // request body carries no user_id, so a browser cannot assert another user's identity (IDOR guard).
  // Unregister is keyed by endpoint only (a possession-proven capability).
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
  // feature 133: no admin gate — strategy ownership is per-user; analysis resolves the caller from
  // the propagated x-user-id header and returns PERMISSION_DENIED for a non-owner (design.md
  // decision 4, C-10(a)). Mirrors the /insights setStrategyLive de-gating.
  setStrategyLive: forward((req, opts) => analysisClient.setStrategyLive(req, opts)),
});

router.service(LedgerService, {
  // Read event query. Two callers: position↔order fill lineage (order.filled, stream_key
  // "order:…") and the Copilot rail thread. For copilot: streams the BFF rewrites the
  // client-supplied key to the per-user thread server-side (the browser never learns the
  // user id and can only read its own thread).
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
  // Copilot rail note persistence — append-only (F-06: no agent DB/LLM/pool). The stream key,
  // event type, and source are forced server-side; the client cannot write outside its thread.
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
  // Read-only — GetConfig is deliberately open on the backend (xstockstrat-config's own
  // Critical Invariant #5), no admin gate needed. Used by the amended AC-5 "one coherent
  // restriction display" on /trader/positions: platform.trading_state, checked before any
  // per-account halt badge (feature 102).
  getConfig: forward((req, opts) => configClient.getConfig(req, opts)),
});

// In the consolidated app there is no basePath — Next.js does NOT strip a prefix.
// The route handler at src/app/trader/api/[...connect]/route.ts receives the full
// URL /trader/api/<service>/<method>, so the handler map key must include the segment prefix.
export const dispatchConnect = createDispatch(router, '/trader/api');
