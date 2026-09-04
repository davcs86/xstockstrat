import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import {
  analysisClient,
  indicatorsClient,
  ingestClient,
  marketDataClient,
  portfolioClient,
  tradingClient,
  ledgerClient,
  configClient,
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

router.service(AnalysisService, {
  async listStrategies(req, ctx) {
    // Send req as-is — analysis filters to the caller's own strategies from the propagated
    // x-user-id header, so the body carries no user_id.
    const claims = await requireSession(ctx);
    return analysisClient.listStrategies(req, { headers: backendHeaders(claims, ctx) });
  },
  scoreStrategy: forward((req, opts) => analysisClient.scoreStrategy(req, opts)),
  runBacktest: forward((req, opts) => analysisClient.runBacktest(req, opts)),
  screenSymbols: forward((req, opts) => analysisClient.screenSymbols(req, opts)),
  getStrategyReport: forward((req, opts) => analysisClient.getStrategyReport(req, opts)),
  listBacktests: forward((req, opts) => analysisClient.listBacktests(req, opts)),
  // Persisted full result of a past run; NOT_FOUND for legacy/evicted runs.
  getBacktest: forward((req, opts) => analysisClient.getBacktest(req, opts)),
  // No admin gate — ownership is per-user; analysis resolves the caller from x-user-id and returns
  // PERMISSION_DENIED for a non-owner.
  manageStrategy: forward((req, opts) => analysisClient.manageStrategy(req, opts)),
  getStrategy: forward((req, opts) => analysisClient.getStrategy(req, opts)),
  listStrategyDefinitions: forward((req, opts) =>
    analysisClient.listStrategyDefinitions(req, opts),
  ),
  // No admin gate — owner-scoped server-side.
  setStrategyLive: forward((req, opts) => analysisClient.setStrategyLive(req, opts)),
  // Opportunity queue + readiness + analytics. All read-only; user comes from the x-user-id header.
  listOpportunities: forward((req, opts) => analysisClient.listOpportunities(req, opts)),
  evaluateReadiness: forward((req, opts) => analysisClient.evaluateReadiness(req, opts)),
  getStrategyAnalytics: forward((req, opts) => analysisClient.getStrategyAnalytics(req, opts)),
  // Per-component indicator series for the Symbol page's overlay panels.
  getIndicatorSeries: forward((req, opts) => analysisClient.getIndicatorSeries(req, opts)),
  // Ranked P&L-attribution factors. Read-only; no admin gate.
  queryPnLPatterns: forward((req, opts) => analysisClient.queryPnLPatterns(req, opts)),
  // Per-source signal-performance attribution. Read-only; owner-scoped from the x-user-id header.
  getAttribution: forward((req, opts) => analysisClient.getAttribution(req, opts)),
});

router.service(IngestService, {
  listSignalSources: forward((req, opts) => ingestClient.listSignalSources(req, opts)),
  triggerBackfill: forward((req, opts) => ingestClient.triggerBackfill(req, opts)),
  async getBackfillStatus(req, ctx) {
    // Read-only progress poll — operators monitor jobs, so no admin gate.
    const claims = await requireSession(ctx);
    return ingestClient.getBackfillStatus(req, { headers: backendHeaders(claims, ctx) });
  },
  async listBackfillJobs(req, ctx) {
    // Read-only listing; forwards the optional `symbol` filter transparently.
    const claims = await requireSession(ctx);
    return ingestClient.listBackfillJobs(req, { headers: backendHeaders(claims, ctx) });
  },
  // Mutating — admin only; the ingest server re-checks the scope.
  cancelBackfill: forwardAdmin((req, opts) => ingestClient.cancelBackfill(req, opts)),
});

router.service(MarketDataService, {
  getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
  // Live price wired on BOTH BFFs so the queue card and Signal-detail header read the same source.
  getLatestPrice: forward((req, opts) => marketDataClient.getLatestPrice(req, opts)),
  // Destructive — admin only; the marketdata server enforces it again.
  deleteBackfilledData: forwardAdmin((req, opts) =>
    marketDataClient.deleteBackfilledData(req, opts),
  ),
});

router.service(PortfolioService, {
  listPortfolios: forward((req, opts) => portfolioClient.listPortfolios(req, opts)),
  // Watchlists — ownership enforced server-side from the x-user-id header; messages carry no user_id.
  createWatchlist: forward((req, opts) => portfolioClient.createWatchlist(req, opts)),
  getWatchlist: forward((req, opts) => portfolioClient.getWatchlist(req, opts)),
  listWatchlists: forward((req, opts) => portfolioClient.listWatchlists(req, opts)),
  updateWatchlist: forward((req, opts) => portfolioClient.updateWatchlist(req, opts)),
  deleteWatchlist: forward((req, opts) => portfolioClient.deleteWatchlist(req, opts)),
  addWatchlistSymbols: forward((req, opts) => portfolioClient.addWatchlistSymbols(req, opts)),
  removeWatchlistSymbols: forward((req, opts) => portfolioClient.removeWatchlistSymbols(req, opts)),
  // Targeted single-symbol rebind — same header-propagating forward as its siblings.
  updateWatchlistBinding: forward((req, opts) => portfolioClient.updateWatchlistBinding(req, opts)),
  // Atomic bulk rebind — same header-propagating forward.
  updateWatchlistBindings: forward((req, opts) =>
    portfolioClient.updateWatchlistBindings(req, opts),
  ),
});

router.service(TradingService, {
  listBrokerAccounts: forward((req, opts) => tradingClient.listBrokerAccounts(req, opts)),
  // The /insights dashboard reads env-derived paper/live mode here (mirrors traderBff) so the segment
  // is self-contained.
  getTradingEnvironment: forward((req, opts) => tradingClient.getTradingEnvironment(req, opts)),
});

// The /insights performance dashboard reads its equity-curve source events + config here.
router.service(LedgerService, {
  // queryEvents forces the caller's own portfolio stream key SERVER-SIDE from the verified session
  // (IDOR guard — the browser must not supply it), mirroring the traderBff copilot force pattern.
  queryEvents: async (req, ctx) => {
    const claims = await requireSession(ctx);
    return ledgerClient.queryEvents(
      { ...req, streamKey: `portfolio:${claims.user_id}` },
      { headers: backendHeaders(claims, ctx) },
    );
  },
});

router.service(ConfigService, {
  // Read-only — GetConfig is deliberately open on the backend (no admin gate), matching traderBff.
  getConfig: forward((req, opts) => configClient.getConfig(req, opts)),
});

router.service(IndicatorsService, {
  async registerFormula(req, ctx) {
    const claims = await requireSession(ctx);
    // Set author from JWT claims — overrides any caller-supplied value
    return indicatorsClient.registerFormula(
      { ...req, author: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  getFormula: forward((req, opts) => indicatorsClient.getFormula(req, opts)),
  listFormulas: forward((req, opts) => indicatorsClient.listFormulas(req, opts)),
  // Author-ownership resolves the caller from the x-user-id header (set from the verified session, not
  // the body), so a caller cannot impersonate another user.
  updateFormula: forward((req, opts) => indicatorsClient.updateFormula(req, opts)),
  deleteFormula: forward((req, opts) => indicatorsClient.deleteFormula(req, opts)),
  executeFormula: forward((req, opts) => indicatorsClient.executeFormula(req, opts)),
  computeIndicator: forward((req, opts) => indicatorsClient.computeIndicator(req, opts)),
  listIndicators: forward((req, opts) => indicatorsClient.listIndicators(req, opts)),
});

// In the consolidated app there is no basePath — the full URL /insights/api/<service>/<method>
// reaches this handler, so the prefix must include the segment path.
export const dispatchConnect = createDispatch(router, '/insights/api');
