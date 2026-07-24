# Test-Data Inventory — xstockstrat-ui

The catalog of centralized mocked/dummy domain data for frontend tests (Playwright e2e +
vitest unit). System rules live in `docs/patterns/test-data-inventory.md`; this file is the
**live catalog** — keep it in the same commit as any fixture change (use the `/test-data`
skill).

## Canonical fixtures

| Domain entity | Fixture symbol(s) | Module | Shape source (proto) | Consumed by |
|---|---|---|---|---|
| Test user identity | `TEST_USER_ID`, `TEST_USER_EMAIL` | `e2e/fixtures/users.ts` | identity JWT claims | `e2e/helpers/auth.ts`, `e2e/mock-backend.ts` (identity handlers), formula fixtures |
| Test JWT signing / auth cookies | `TEST_JWT_SECRET`, `signTestJwt`, `addAuthCookie`, `addAdminCookie`, `addCookieWithRoles` | `e2e/helpers/auth.ts` (canonical helper home) | HS256 JWT minted like xstockstrat-identity | all specs, `e2e/mock-backend.ts`, `playwright.config.ts` (`JWT_SECRET` env) |
| Broker accounts | `BROKER_ACCOUNT_ALPACA`, `BROKER_ACCOUNT_IBKR`, `BROKER_ACCOUNT_NEW`, `BROKER_ACCOUNTS` | `e2e/fixtures/accounts.ts` | `xstockstrat.trading.v1.BrokerAccount` | `e2e/mock-backend.ts` (trader + insights `listBrokerAccounts`, register/update), `e2e/trader/{orders,order-form,account-selector}.spec.ts`, `e2e/insights/account-portfolio.spec.ts` |
| Portfolios | `PORTFOLIO_ALPACA`, `PORTFOLIO_IBKR`, `PORTFOLIOS` | `e2e/fixtures/portfolios.ts` | `xstockstrat.portfolio.v1.Portfolio` | `e2e/mock-backend.ts` (trader + insights `listPortfolios`), `e2e/insights/account-portfolio.spec.ts` |
| Strategy scores | `STRATEGY_SCORE_{HIGH,MID,LOW}`, `STRATEGY_SCORES` | `e2e/fixtures/strategies.ts` | `xstockstrat.analysis.v1.StrategyScore` | `e2e/mock-backend.ts` (`listStrategies`), `e2e/insights/dashboard.spec.ts` |
| Strategy definitions | `STRATEGY_DEF_LIVE`, `STRATEGY_DEF_INACTIVE`, `STRATEGY_DEFINITIONS` | `e2e/fixtures/strategies.ts` | `xstockstrat.analysis.v1.StrategyDefinition` | `e2e/mock-backend.ts` (`listStrategyDefinitions`, `setStrategyLive`), `e2e/trader/live-strategies.spec.ts` (asserts `strat-live-001`) |
| Custom formulas | `FORMULA_RSI`, `FORMULA_MACD`, `FORMULAS` | `e2e/fixtures/formulas.ts` | `xstockstrat.indicators.v1.FormulaDefinition` (list row) | `e2e/insights/formulas.spec.ts`, `e2e/insights/strategy-authoring.spec.ts` |

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

## Not yet centralized

Inline mock data that remains local to one file. Policy: **migrate opportunistically** — when
a feature/bug touches one of these domains, or a second consumer appears, move the data into
a fixture module and register it above (never copy-paste it into a second site).

| Domain | Current home |
|---|---|
| Orders (list + management states) | `e2e/mock-backend.ts` (`listOrders`), `e2e/trader/orders.spec.ts` (`ORDERS`) — two different order sets, each single-site |
| Aggregate portfolio (`getPortfolio`) | `e2e/mock-backend.ts` |
| Positions (`listPositions`) | `e2e/mock-backend.ts` |
| Ledger events | `e2e/mock-backend.ts` (`queryEvents`) |
| Alerts (stream + list) | `e2e/mock-backend.ts` (`streamAlerts`, `listAlerts`) |
| OHLCV bars / assets | `e2e/mock-backend.ts` (`getBars`, `listAssets`) |
| Backtest results / diagnostics / coverage gaps | `e2e/mock-backend.ts` (`runBacktest`, `listBacktests`) |
| Screener results | `e2e/mock-backend.ts` (`screenSymbols`) |
| Editable strategy components (`getStrategy`) | `e2e/mock-backend.ts` |
| Config keys | `e2e/mock-backend.ts` (`listKeys`) |
| Signal sources | `e2e/mock-backend.ts` (`listSignalSources`, `manageSignalSource`) |
| OAuth authorized apps | `e2e/mock-backend.ts` (`listAuthorizedApps`) |
| Backfill jobs | `e2e/insights/backfills.spec.ts` (`runningJob()` factory) |
| Watchlists (stateful mock) | `e2e/insights/watchlists.spec.ts` (`mockWatchlists`) |
| MCP tool list | `e2e/accounts/mcp-tools.spec.ts` (`SAMPLE_TOOLS`) |
