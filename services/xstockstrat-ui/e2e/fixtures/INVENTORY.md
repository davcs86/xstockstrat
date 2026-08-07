# Test-Data Inventory — xstockstrat-ui

The catalog of centralized mocked/dummy domain data for frontend tests (Playwright e2e +
vitest unit). System rules live in `docs/patterns/test-data-inventory.md`; this file is the
**live catalog** — keep it in the same commit as any fixture change (use the `/sdd-qa`
skill).

## Canonical fixtures

| Domain entity | Fixture symbol(s) | Module | Shape source (proto) | Consumed by |
|---|---|---|---|---|
| Test user identity | `TEST_USER_ID`, `TEST_USER_EMAIL` | `e2e/fixtures/users.ts` | identity JWT claims | `e2e/helpers/auth.ts`, `e2e/mock-backend.ts` (identity handlers), formula fixtures |
| Test JWT signing / auth cookies | `TEST_JWT_SECRET`, `signTestJwt`, `addAuthCookie`, `addAdminCookie`, `addCookieWithRoles` | `e2e/helpers/auth.ts` (canonical helper home) | HS256 JWT minted like xstockstrat-identity | all specs, `e2e/mock-backend.ts`, `playwright.config.ts` (`JWT_SECRET` env) |
| Broker accounts | `BROKER_ACCOUNT_ALPACA`, `BROKER_ACCOUNT_IBKR`, `BROKER_ACCOUNT_NEW`, `BROKER_ACCOUNTS` | `e2e/fixtures/accounts.ts` | `xstockstrat.trading.v1.BrokerAccount` | `e2e/mock-backend.ts` (trader + insights `listBrokerAccounts`, register/update), `e2e/trader/{orders,order-form,account-selector}.spec.ts`, `e2e/insights/account-portfolio.spec.ts`, `e2e/trader/positions-reconciliation.spec.ts` (spread-override `halted`/`haltReason`/`haltSource`, feature 102) |
| Portfolios | `PORTFOLIO_ALPACA`, `PORTFOLIO_IBKR`, `PORTFOLIOS` | `e2e/fixtures/portfolios.ts` | `xstockstrat.portfolio.v1.Portfolio` | `e2e/mock-backend.ts` (trader + insights `listPortfolios`), `e2e/insights/account-portfolio.spec.ts` |
| Strategy scores | `STRATEGY_SCORE_{HIGH,MID,LOW}`, `STRATEGY_SCORES` | `e2e/fixtures/strategies.ts` | `xstockstrat.analysis.v1.StrategyScore` | `e2e/mock-backend.ts` (`listStrategies`), `e2e/insights/dashboard.spec.ts` |
| Strategy definitions | `STRATEGY_DEF_LIVE`, `STRATEGY_DEF_INACTIVE`, `STRATEGY_DEFINITIONS` | `e2e/fixtures/strategies.ts` | `xstockstrat.analysis.v1.StrategyDefinition` | `e2e/mock-backend.ts` (`listStrategyDefinitions`, `setStrategyLive`), `e2e/trader/live-strategies.spec.ts` (asserts `strat-live-001`) |
| Custom formulas | `FORMULA_RSI`, `FORMULA_MACD`, `FORMULAS` | `e2e/fixtures/formulas.ts` | `xstockstrat.indicators.v1.FormulaDefinition` (list row) | `e2e/insights/formulas.spec.ts`, `e2e/insights/strategy-authoring.spec.ts` |
| Soft-deleted formula (086) | `FORMULA_DELETED` | `e2e/fixtures/formulas.ts` | `xstockstrat.indicators.v1.FormulaDefinition` (full, `deleted: true`) | `e2e/insights/formula-deletion.spec.ts` (GetFormula stub) |
| Backtest coverage gaps | `insufficientDataResult`, `prefixGapRange`, `BACKTEST_GAP_{SYMBOL,BARS_HAVE,BARS_NEED}`, `BACKTEST_PREFIX_DAYS` | `e2e/fixtures/backtests.ts` | `xstockstrat.analysis.v1.CoverageGap` / `BacktestResult` | `e2e/mock-backend.ts` (`runBacktest` default branch), `e2e/insights/backtest-coverage.spec.ts` |
| Opportunity queue | `OPPORTUNITIES` (rows carry `opportunityKey` + `provenance`, feature 097) | `e2e/fixtures/opportunities.ts` | `xstockstrat.analysis.v1.Opportunity` | `e2e/mock-backend.ts` (`listOpportunities`), `e2e/insights/opportunities.spec.ts` (also a per-page `page.route()` stateful ListOpportunities/SetOpportunityAction mock proving snooze/dismiss reload-persistence — see the spec), `e2e/insights/watchlists.spec.ts` (in-queue mark, feature 098) |
| Symbol readiness | `symbolReadiness` (single-arg factory) | `e2e/fixtures/opportunities.ts` | `xstockstrat.analysis.v1.SymbolReadiness` | `e2e/mock-backend.ts` (`evaluateReadiness` — spreads `READINESS_BUCKET_OVERRIDE` over it; keep single-arg, the `.map` is an arrow), `e2e/insights/watchlists.spec.ts` (readiness rollup, feature 098) |
| Watchlists (stateful mock) | `mockWatchlists`, `MockWatchlist`, `MockBinding` (per-symbol `(symbol, strategyId)` bindings + `UpdateWatchlist` route, feature 097) | `e2e/helpers/watchlistMock.ts` | `xstockstrat.portfolio.v1.Watchlist` CRUD RPCs | `e2e/insights/watchlists.spec.ts`, `e2e/insights/screener.spec.ts` (Save/Add-top-N, feature 098) |
| Positions | `POSITION_AAPL` (`stopOrderId`/`takeProfitOrderId` set, feature 030), `POSITION_MSFT` (both omitted — exercises the em-dash "no active bracket" fallback), `POSITIONS`, `positionForSymbol` | `e2e/fixtures/positions.ts` | `xstockstrat.portfolio.v1.Position` | `e2e/mock-backend.ts` (`listPositions`, `getPosition`), `e2e/trader/{positions,position-detail,valuation-parity}.spec.ts` |
| Orders (shared mock set) | `ORDER_FILLED`, `ORDER_WORKING`, `ORDER_UNKNOWN_INTENT` (`intentState=4/UNKNOWN`, feature 101), `ORDERS`, `orderForId` | `e2e/fixtures/orders.ts` | `xstockstrat.trading.v1.Order` | `e2e/mock-backend.ts` (`listOrders`, `getOrder`), `e2e/trader/{order-ticket,order-intent}.spec.ts` |
| Config key SetConfig payload | `setConfigPayload` | `e2e/fixtures/configKeys.ts` | `xstockstrat.config.v1.SetConfigRequest` | `e2e/config-ui/api-smoke.spec.ts` |

## Recurring sentinel ids (stay inline, but are reserved)

Scenario-trigger ids that `e2e/mock-backend.ts` pattern-matches on. Don't reuse them for
other meanings; don't rename without updating every listed site.

| Sentinel | Meaning | Sites |
|---|---|---|
| `strat-diag-001` | `RunBacktest` returns OK + per-bar diagnostics (feature 064) | `e2e/mock-backend.ts` |
| `strat-formula-error-001` | `RunBacktest` returns `NO_TRADE_REASON_FORMULA_ERROR` (feature 067) | `e2e/mock-backend.ts` |
| `strat-notfound-001` | `GetStrategyReport` throws NOT_FOUND (cleared grade, feature 065) | `e2e/mock-backend.ts` |
| `strat-history-001` | Strategy with persisted score + backtest run history | `e2e/mock-backend.ts` |
| `invalid_ref` | `ManageStrategy` throws INVALID_ARGUMENT (wizard error path) | `e2e/mock-backend.ts`, `e2e/insights/strategy-authoring.spec.ts` |
| `READY1` / `WATCH1` / `QUIET1` / `NODATA1` | `evaluateReadiness` forces the ready / watching / quiet / no-data bucket for that symbol (feature 098 rollup e2e) — never AAPL/MSFT so other specs' default 2/3 shape is untouched | `e2e/mock-backend.ts` (`READINESS_BUCKET_OVERRIDE`), `e2e/insights/watchlists.spec.ts` |
| `strat-exit-cooldown-7` | `GetStrategy` returns a non-default `exitCooldownDays: 7` (edit-prepopulation e2e, feature 116) | `e2e/mock-backend.ts`, `e2e/insights/strategy-authoring.spec.ts` |

## Not yet centralized

Inline mock data that remains local to one file. Policy: **migrate opportunistically** — when
a feature/bug touches one of these domains, or a second consumer appears, move the data into
a fixture module and register it above (never copy-paste it into a second site).

| Domain | Current home |
|---|---|
| Orders (scenario overrides) | `e2e/trader/orders.spec.ts` + `e2e/trader/order-parity.spec.ts` — bespoke `page.route()` order sets, each single-site (the shared mock-backend set is centralized in `e2e/fixtures/orders.ts`) |
| Aggregate portfolio (`getPortfolio`) | `e2e/mock-backend.ts` |
| Ledger events | `e2e/mock-backend.ts` (`queryEvents`) |
| Alerts (stream + list) | `e2e/mock-backend.ts` (`streamAlerts`, `listAlerts`) |
| OHLCV bars / assets | `e2e/mock-backend.ts` (`getBars`, `listAssets`) — bars carry the canonical `timeframe: '1d'` **plus** `timeframeEnum` (feature 080) |
| Backtest diagnostics + run history | `e2e/mock-backend.ts` (`runBacktest` sentinel branches, `listBacktests`) — the coverage-gap half was centralized by feature 071; the `strat-diag-001` / `strat-formula-error-001` diagnostics and the run-history rows are still inline |
| Screener results | `e2e/mock-backend.ts` (`screenSymbols`) |
| Editable strategy components (`getStrategy`) | `e2e/mock-backend.ts` |
| Signal sources | `e2e/mock-backend.ts` (`listSignalSources`, `manageSignalSource`) |
| OAuth authorized apps | `e2e/mock-backend.ts` (`listAuthorizedApps`) |
| Backfill jobs | `e2e/insights/backfills.spec.ts` (`runningJob()` factory) — carries **both** `timeframe: '1d'` and `timeframeEnum: 'TIMEFRAME_1DAY'` (feature 080) |
| MCP tool list | `e2e/accounts/mcp-tools.spec.ts` (`SAMPLE_TOOLS`) |
| Copilot rail thread notes | `e2e/fixtures/copilotThread.ts` (`COPILOT_NOTE`/`COPILOT_NOTE_TEXT`) + `e2e/mock-backend.ts` (in-memory `copilotThreads` store via `appendEvent`/`queryEvents`) |
