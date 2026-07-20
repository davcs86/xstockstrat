import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import {
  tradingClient,
  portfolioClient,
  marketDataClient,
  notifyClient,
  analysisClient,
  ledgerClient,
} from '@/lib/connectClients';
import {
  createBffRouter,
  createDispatch,
  requireSession,
  backendHeaders,
  forward,
  forwardAdmin,
} from '@/lib/bffShared';

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
});

router.service(MarketDataService, {
  getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
  listAssets: forward((req, opts) => marketDataClient.listAssets(req, opts)),
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
  // Admin scope gate — enforced server-side before forwarding to the gRPC service.
  setStrategyLive: forwardAdmin((req, opts) => analysisClient.setStrategyLive(req, opts)),
});

router.service(LedgerService, {
  // Read-only event query — used for position↔order fill lineage (order.filled events).
  queryEvents: forward((req, opts) => ledgerClient.queryEvents(req, opts)),
});

// In the consolidated app there is no basePath — Next.js does NOT strip a prefix.
// The route handler at src/app/trader/api/[...connect]/route.ts receives the full
// URL /trader/api/<service>/<method>, so the handler map key must include the segment prefix.
export const dispatchConnect = createDispatch(router, '/trader/api');
