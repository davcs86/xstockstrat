import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import {
  analysisClient,
  indicatorsClient,
  ingestClient,
  marketDataClient,
  portfolioClient,
  tradingClient,
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
    // feature 133: send req as-is — analysis filters to the caller's own strategies from the
    // propagated x-user-id header (backendHeaders), so the request body carries no user_id
    // (design.md decision 3 removed the dead wire field).
    const claims = await requireSession(ctx);
    return analysisClient.listStrategies(req, { headers: backendHeaders(claims, ctx) });
  },
  scoreStrategy: forward((req, opts) => analysisClient.scoreStrategy(req, opts)),
  runBacktest: forward((req, opts) => analysisClient.runBacktest(req, opts)),
  screenSymbols: forward((req, opts) => analysisClient.screenSymbols(req, opts)),
  getStrategyReport: forward((req, opts) => analysisClient.getStrategyReport(req, opts)),
  listBacktests: forward((req, opts) => analysisClient.listBacktests(req, opts)),
  // feature 068: persisted full result of a past run; NOT_FOUND for legacy/evicted runs.
  getBacktest: forward((req, opts) => analysisClient.getBacktest(req, opts)),
  // feature 133: no admin gate. Strategy ownership is per-user now — analysis resolves the caller
  // from the propagated x-user-id header and returns PERMISSION_DENIED for a non-owner (design.md
  // decision 4). The old admin-only mutation gate (FR-8) is removed.
  manageStrategy: forward((req, opts) => analysisClient.manageStrategy(req, opts)),
  getStrategy: forward((req, opts) => analysisClient.getStrategy(req, opts)),
  listStrategyDefinitions: forward((req, opts) =>
    analysisClient.listStrategyDefinitions(req, opts),
  ),
  // feature 133: no admin gate — owner-scoped server-side (design.md decision 4, C-10(a)).
  setStrategyLive: forward((req, opts) => analysisClient.setStrategyLive(req, opts)),
  // feature 083 — opportunity queue + readiness + per-strategy analytics. All read-only;
  // ListOpportunities takes its user from the propagated x-user-id header (forward → backendHeaders).
  listOpportunities: forward((req, opts) => analysisClient.listOpportunities(req, opts)),
  evaluateReadiness: forward((req, opts) => analysisClient.evaluateReadiness(req, opts)),
  getStrategyAnalytics: forward((req, opts) => analysisClient.getStrategyAnalytics(req, opts)),
  // feature 125 (FR-6): per-component indicator series for the Symbol page's overlay panels.
  getIndicatorSeries: forward((req, opts) => analysisClient.getIndicatorSeries(req, opts)),
  // feature 042: ranked P&L-attribution factors. Read-only; no admin gate.
  queryPnLPatterns: forward((req, opts) => analysisClient.queryPnLPatterns(req, opts)),
});

router.service(IngestService, {
  listSignalSources: forward((req, opts) => ingestClient.listSignalSources(req, opts)),
  triggerBackfill: forward((req, opts) => ingestClient.triggerBackfill(req, opts)),
  async getBackfillStatus(req, ctx) {
    // Read-only progress poll — operators monitor jobs, so no admin gate (FR-2/FR-3).
    const claims = await requireSession(ctx);
    return ingestClient.getBackfillStatus(req, { headers: backendHeaders(claims, ctx) });
  },
  async listBackfillJobs(req, ctx) {
    // Read-only listing; forwards the optional `symbol` filter transparently (FR-3).
    const claims = await requireSession(ctx);
    return ingestClient.listBackfillJobs(req, { headers: backendHeaders(claims, ctx) });
  },
  // Mutating — admin only (FR-7); the ingest server re-checks the scope (Step 3).
  cancelBackfill: forwardAdmin((req, opts) => ingestClient.cancelBackfill(req, opts)),
});

router.service(MarketDataService, {
  getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
  // Destructive — admin only (FR-7); the marketdata server enforces it again (Step 5).
  deleteBackfilledData: forwardAdmin((req, opts) =>
    marketDataClient.deleteBackfilledData(req, opts),
  ),
});

router.service(PortfolioService, {
  listPortfolios: forward((req, opts) => portfolioClient.listPortfolios(req, opts)),
  // Watchlists (feature 058). Ownership is enforced server-side from the propagated
  // x-user-id header (forwarded by backendHeaders) — request messages carry no user_id.
  createWatchlist: forward((req, opts) => portfolioClient.createWatchlist(req, opts)),
  getWatchlist: forward((req, opts) => portfolioClient.getWatchlist(req, opts)),
  listWatchlists: forward((req, opts) => portfolioClient.listWatchlists(req, opts)),
  updateWatchlist: forward((req, opts) => portfolioClient.updateWatchlist(req, opts)),
  deleteWatchlist: forward((req, opts) => portfolioClient.deleteWatchlist(req, opts)),
  addWatchlistSymbols: forward((req, opts) => portfolioClient.addWatchlistSymbols(req, opts)),
  removeWatchlistSymbols: forward((req, opts) => portfolioClient.removeWatchlistSymbols(req, opts)),
});

router.service(TradingService, {
  listBrokerAccounts: forward((req, opts) => tradingClient.listBrokerAccounts(req, opts)),
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
  // The author-ownership check resolves the caller from the propagated x-user-id header
  // (backendHeaders); the request-body user_id is deprecated, so these forward unchanged. A caller
  // still cannot impersonate another user — the header is set from the verified session, not the body.
  updateFormula: forward((req, opts) => indicatorsClient.updateFormula(req, opts)),
  deleteFormula: forward((req, opts) => indicatorsClient.deleteFormula(req, opts)),
  executeFormula: forward((req, opts) => indicatorsClient.executeFormula(req, opts)),
  computeIndicator: forward((req, opts) => indicatorsClient.computeIndicator(req, opts)),
  listIndicators: forward((req, opts) => indicatorsClient.listIndicators(req, opts)),
});

// In the consolidated app there is no basePath — the full URL /insights/api/<service>/<method>
// reaches this handler, so the prefix must include the segment path.
export const dispatchConnect = createDispatch(router, '/insights/api');
