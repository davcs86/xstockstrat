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
  async placeOrder(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.placeOrder(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async listOrders(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.listOrders(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  getOrder: forward((req, opts) => tradingClient.getOrder(req, opts)),
  cancelOrder: forward((req, opts) => tradingClient.cancelOrder(req, opts)),
  async replaceOrder(req, ctx) {
    const claims = await requireSession(ctx);
    // Inject the verified session user so a client cannot replace another user's order.
    return tradingClient.replaceOrder(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
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
  async getPortfolio(req, ctx) {
    const claims = await requireSession(ctx);
    return portfolioClient.getPortfolio(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async listPortfolios(req, ctx) {
    const claims = await requireSession(ctx);
    // No user_id field on the request — the service resolves the user from the
    // propagated x-user-id header to aggregate the all-accounts view.
    return portfolioClient.listPortfolios(req, { headers: backendHeaders(claims, ctx) });
  },
  async listPositions(req, ctx) {
    const claims = await requireSession(ctx);
    // Inject the verified session user so positions are always scoped to the caller.
    return portfolioClient.listPositions(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async getPosition(req, ctx) {
    const claims = await requireSession(ctx);
    // Single-position read for the dedicated Position page (feature 096). Same userId
    // injection as listPositions so the position is always scoped to the verified caller.
    return portfolioClient.getPosition(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
});

router.service(MarketDataService, {
  getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
  listAssets: forward((req, opts) => marketDataClient.listAssets(req, opts)),
  // feature 125 (FR-7) — read-only, ungated (matches GetFundamentals' backend contract); the one
  // genuinely new BFF registration this feature needs (absent from both trader and insights BFFs).
  getFundamentals: forward((req, opts) => marketDataClient.getFundamentals(req, opts)),
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
