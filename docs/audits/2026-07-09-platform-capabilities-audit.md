# Platform Capabilities Audit — Product Review

**Date:** 2026-07-09
**Audited against:** `main-dev` @ `b1ea0d4` ("feat: backtest debug diagnostics (feature 064) (#754)")
**Scope:** The whole xstockstrat platform — web UI, backend gRPC services, data sources, and the MCP agent tool suite.
**Nature:** Advisory product-manager review. This document changes no lifecycle statuses; feature status truth remains in each `docs/roadmap/features/<NNN-slug>/feature.md`.

---

## 1. Executive Summary

xstockstrat is a self-hosted stock-strategy platform covering the full loop: **signal ingestion → indicator/formula computation → screening → backtesting → live strategy evaluation → paper/live order execution → alerting**. All 7 roadmap phases are DONE and 39 features are `launched` (of 66 tracked), with 3 more `code-completed`. The platform is functionally deep for a research-and-execution workflow, exposed consistently across three surfaces (web UI, gRPC API, MCP agent).

**Top 5 findings:**

1. **Live trading is enabled ahead of its safety rails.** Live strategy evaluation and order execution are launched (047/048), but stop-loss/bracket orders (030) and the position sizing engine (023) are still `draft`. For a trading product this is the highest-priority sequencing risk: a strategy can go live with no automated downside protection and no principled sizing.
2. **Alerts dead-end inside the platform.** The notify service persists and streams alerts in-app, but external fan-out (Telegram/Slack/email, feature 020) is `draft`. A live-strategy alert engine whose alerts are only visible while a user is looking at the UI undercuts the core value of feature 048.
3. **The MCP agent bypasses least-privilege.** Three mutating agent tools hardcode admin scope (`x-access-scope: 7`) downstream, backends see a single shared agent principal (`MCP_AGENT_SECRET`, unenforced when empty), and the OAuth 2.1 user identity gates the connection but never propagates to backends (`services/xstockstrat-agent/app/client.py:288,456,598`).
4. **Documentation has drifted from the shipped product.** `README.md` still shows the pre-045 three-frontend + nginx topology; `docs/runbooks/mcp-tools.md` documents 10 of 11 tools (no `set_strategy_live` section) and a pre-064 `run_backtest` return shape.
5. **Roadmap hygiene: duplicate feature numbers.** `058-formula-parameters` / `058-watchlist-management` and `064-backtest-debug-info` / `064-persist-strategy-scores` collide, violating the root `CLAUDE.md` numbering rule ("never reuse a number"). Both `058-*` are `launched`, so their numbers are now immutable — the collision is permanent unless documented as an accepted exception.

---

## 2. Capability Map

What a user can do today, where, and its status. "Surface" legend: **UI** = `xstockstrat-ui` route, **RPC** = gRPC service, **MCP** = agent tool.

| Capability | What the user can do | Surfaces | Status / evidence |
|---|---|---|---|
| **Trading & broker accounts** | Place/cancel/replace orders (market, limit, stop, stop-limit, trailing-stop); manage Alpaca **and** IBKR broker accounts with credential-status badges; stream order updates. Paper/live mode is deployment-fixed (intentional safety), reported via `GetTradingEnvironment`. | UI `/trader`, `/trader/orders`, `/trader/accounts` · RPC `TradingService` | Launched (001, 002, 055). `packages/proto/trading/v1/trading.proto`, `services/xstockstrat-trading/internal/broker/{alpaca,ibkr}.go` |
| **Portfolio & positions** | View portfolio, positions (long/short), P&L, snapshots; live portfolio stream. Positions valuation fixed on main-dev (#735). | UI `/trader/positions`, `/insights` dashboard · RPC `PortfolioService` | Launched (056) |
| **Watchlists** | Full CRUD + add/remove symbols; owner-scoped via `x-user-id`; caps via `portfolio.watchlist.*` config. | UI `/insights/watchlists` · RPC `PortfolioService` | Launched (058-watchlist-management) |
| **Market data (OHLCV/quotes)** | Historical bars, latest quotes, live bar/quote streams, asset listing, data-coverage inspection with gap detection. **Alpaca is the sole OHLCV source**; smallest timeframe is 15min (sub-15min enum values deprecated, matching the free 15-min-delayed Alpaca plan). | UI `/insights/market/[symbol]`, chart panel · RPC `MarketDataService` | Launched (013, 014). `packages/proto/marketdata/v1/marketdata.proto` |
| **Backfills** | Trigger, monitor, cancel durable/resumable/chunked historical backfills (FULL or GAPS_ONLY); scoped deletes with window cap (`marketdata.backfill.max_delete_days`). | UI `/insights/backfills` · RPC `IngestService` + `MarketDataService` | Launched (052, 054, 057) |
| **Fundamentals** | FMP-backed read-through cache (`GetFundamentals`/`GetFundamentalsMulti`): market cap, PE, PB, dividend yield, EPS, beta, ROE, D/E + extensible `extra_metrics`; quota-budgeted (250 req/UTC-day free tier) with `stale` flagging. | RPC `MarketDataService` · consumed by screener/formulas/signal producer | Launched (059) |
| **Indicators & custom formulas** | Built-ins (SMA/EMA/RSI/MACD/BB/ATR/VWAP) plus author-scoped custom formulas in sandboxed Python (timeout/memory/import guards) with typed parameters, named output series, and warmup periods. Full authoring UI with run-preview. | UI `/insights/formulas` · RPC `IndicatorsService` · MCP `manage_formula` | Launched (003, 058-formula-parameters) |
| **Screening** | Rank a symbol universe over weighted fundamental/technical/signal criteria with hard filters; coverage-gap reporting; caps via `analysis.screener.*` config. | UI `/insights/screener` · RPC `AnalysisService.ScreenSymbols` · MCP `screen_symbols` | Launched (060, 061) |
| **Backtesting** | Run backtests against stored or inline strategy definitions; on main-dev, per-symbol day-by-day **diagnostics** (bar-level indicator values, warmup flags, entry/exit/conviction, `no_trade_reason`) surfaced in the strategy detail UI — directly answers "why did my backtest make zero trades?". | UI `/insights/strategies/[id]` (`BacktestDiagnostics.tsx`) · RPC `AnalysisService.RunBacktest` · MCP `run_backtest` | Launched (053) + code-completed (064-backtest-debug-info) |
| **Strategy engine & live evaluation** | Compose strategies from components via wizard; score strategies (scores now persisted across restarts); flip a strategy to continuous live evaluation with alerting. | UI `/insights/strategies`, LiveStrategiesPanel (admin-gated) · RPC `AnalysisService` · MCP `manage_strategy`, `set_strategy_live` | Launched (047, 048, 050) + code-completed (064-persist-strategy-scores) |
| **Signal ingestion** | Register email/website signal sources (10 source types incl. mediated variants) with weighting; extract content (PDF attachments via PyMuPDF, gated URLs); ingest buy/sell/hold/watchlist signals with conviction; auto-alert above `agent.signal.alert_threshold`. Named sources: unusual_whales, marketwatch, dividendology, pure_power_picks, simply_wall_st. | UI `/config-ui/sources` · RPC `IngestService` · MCP `list_signal_sources`, `extract_*`, `ingest_signal`, `manage_signal_source` | Launched (007, 008, 009) |
| **Fundamentals signal producer** | Daily background loop scores cached fundamentals over the watchlist/explicit universe and emits derived buy/sell/hold signals; budget-aware, off by default (`analysis.fundsignal.enabled`). | RPC `AnalysisService.RunFundamentalsScan` (admin) | Launched (062, 063) |
| **Alerting** | Emit, acknowledge, list alerts; long-lived alert stream filtered by user/category/severity (INFO→CRITICAL). **In-app only** — no external channels yet. | RPC `NotifyService` · MCP `emit_alert` | Launched core; external fan-out `draft` (020) |
| **Event ledger** | Append-only event store with idempotency-key dedup, query, and replay-then-tail streaming. | RPC `LedgerService` | Launched |
| **Config governance** | Live config over `WatchConfig` stream (snapshot/delta/reload); namespace-scoped editing UI across 10 services, env×trading-mode scoping, secret redaction, validation rules, audit log. | UI `/config-ui`, `/config-ui/audit` · RPC `ConfigService` | Launched (016) |
| **Identity & OAuth** | Unified login; JWT auth; OAuth 2.1 AS with PKCE-only dynamic client registration, audience-bound tokens (RFC 8707), rotating refresh tokens; authorized-apps management UI. | UI `/auth/*`, `/accounts/authorized-apps` · RPC `IdentityService` | Launched (019, 049, 051) |
| **MCP agent** | 11 tools spanning ingestion, extraction, alerting, backtesting, screening, formula/strategy/source management, live toggling; stdio (local) or OAuth-gated SSE/Streamable HTTP (remote); browsable tool catalog in the UI. | MCP server :9000 · UI `/accounts/mcp-tools` (new, #736) | Launched (009) |
| **Observability** | OTel → OTLP → Grafana Cloud across all services; init failures never block startup. | Ops-facing | Code-completed (033) |

---

## 3. Access Surfaces & Parity

The same capability set cross-cuts three surfaces:

- **Web UI** — one Next.js app, four segments: `/trader` (execution), `/insights` (research/authoring), `/config-ui` (operator), `/accounts` (identity/integrations). Nav source of truth: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`.
- **gRPC API** — 11 services, ~70 RPCs. Seven server-streaming RPCs carry all real-time behavior: `StreamOrderUpdates`, `StreamPortfolioUpdates`, `StreamBars`, `StreamQuotes`, `StreamEvents`, `StreamAlerts`, `WatchConfig`. No client-streaming or bidi anywhere — a clean, easily-proxied surface.
- **MCP agent** — 11 tools (`services/xstockstrat-agent/app/tools.py`), now self-describing via unauthenticated `GET /api/tools` and browsable at `/accounts/mcp-tools`.

**Parity observations:**

| Capability | UI | gRPC | MCP | Note |
|---|---|---|---|---|
| Order placement / broker accounts | ✅ | ✅ | ❌ | No agent trading tool. Defensible as a safety boundary — but it is nowhere *stated* as a deliberate boundary. Recommend documenting it as policy (see R7). |
| Watchlist management | ✅ | ✅ | ❌ | Agent workflows that build universes (screen → backtest) cannot persist a watchlist. Minor gap. |
| Backtest / screen / signals / formulas / strategies | ✅ | ✅ | ✅ | Strong parity — the research loop is fully agent-drivable. |
| Alert consumption | ✅ (stream) | ✅ | ❌ (emit-only) | Agent can emit but not read alerts; acceptable given MCP's request/response model. |
| Config editing | ✅ | ✅ | ❌ | Correctly excluded from the agent. |

---

## 4. Roadmap Posture

66 feature directories; distribution as of `b1ea0d4` (computed from `**Lifecycle Status**` in each `feature.md` — the full listing is in Appendix B):

| Stage | Count | Notable |
|---|---|---|
| `launched` | 39 | Everything in §2 marked Launched |
| `code-completed` | 3 | 033-phase7-observability, 064-backtest-debug-info, 064-persist-strategy-scores |
| `draft` | 11 | 010-agent-scheduler, 020-notify-external-fanout, 021-ledger-event-export, 022-signal-time-decay, 023-position-sizing-engine, 029-signal-performance-attribution, 030-stop-loss-bracket-orders, 031-strategy-performance-dashboard, 032-walk-forward-backtesting, 042-order-snapshots-pnl-patterns, 043-user-management-ui |
| `idea` | 3 | 017-premarket-aftermarket-session-toggle, 039/040-timescaledb-compression/retention |
| `demoted/canceled` | 10 | See "won't do" below |

**The explicit "won't do" boundary** (canceled features bound the product's negative space): no crypto (027), no options (034), no realtime tick streaming (025), no ML price prediction (024), no social/copy trading (026), no MPT optimization (028), no automated rebalancing (036), no multi-broker smart routing (037), no SEC-filing sentiment (035). This is a healthy, focused scope: **equities, signal-driven, strategy-centric**.

**Sequencing observation:** the draft queue contains the platform's biggest value-completers. Live trading shipped (047/048) before its guardrails (030, 023) and before its feedback loop (029 signal attribution, 031 strategy performance dashboard, 032 walk-forward validation). The recommended order in §6 re-sequences around risk first, then trust-in-results.

---

## 5. Gaps, Risks & Product Debt

### 5.1 Trading safety gap (highest priority)

Live strategy alerting and live order execution exist, but:

- **No stop-loss / bracket orders** (030 `draft`) — exits are strategy-rule-only; a live position has no automated downside protection at the broker level.
- **No position sizing engine** (023 `draft`) — order quantities are manual/strategy-hardcoded; no risk-based sizing.
- `analysis.NoTradeReason.NO_TRADE_REASON_INSUFFICIENT_CAPITAL` is reserved-not-emitted, consistent with sizing not yet being modeled.

A user can flip a strategy live today with neither. Even with deployment-fixed paper mode as the default posture, the live deployment path exists.

### 5.2 Alert delivery dead-ends in-app

`NotifyService` persists alerts and serves `StreamAlerts`, but there are no external channel adapters in `services/xstockstrat-notify/src` (020 `draft`). The live-strategy alert engine (048) and signal auto-alerts therefore only reach users who have the UI open. For a signals product, delivery is half the feature.

### 5.3 MCP agent trust model (least-privilege gap)

- The OAuth 2.1 edge auth (049B) is genuinely well-built: PKCE-only DCR, audience-bound JWTs, rotating refresh tokens, stateless HMAC-signed authorize transactions. **But identity stops at the edge**: downstream gRPC calls carry only the shared `x-mcp-secret`, and `manage_strategy`, `manage_signal_source`, `set_strategy_live` append a hardcoded `x-access-scope: 7` (admin) regardless of the connected user (`services/xstockstrat-agent/app/client.py:288,456,598`).
- `MCP_AGENT_SECRET` enforcement is disabled when the var is empty (`client.py:25-26` and receiving services) — a fail-open default.
- `manage_formula` authorization relies on a caller-supplied `formula_author_user_id` parameter rather than the authenticated identity — spoofable by any connected client.
- Net effect: every authenticated MCP user is effectively a platform admin for those tool paths.

### 5.4 Reliability seams

- **Best-effort auto-alert:** in `ingest_signal`, a failed alert emission after successful signal ingestion is only `log.warning`-ed — the signal lands, the alert silently doesn't (`services/xstockstrat-agent/app/tools.py`). Acceptable-by-design, but invisible to the user; a `alert_emitted: false` field in the tool response would make it observable.
- **Single-provider concentration:** Alpaca is the sole OHLCV source (proto states "sole Alpaca integration point"); an Alpaca outage stalls ingestion, charts, and live evaluation. The architecture is provider-ready (source-aware schema, `docs/runbooks/add-data-source.md` lists Polygon/Tiingo/Yahoo/Quandl/IBKR as config-plus-client additions) but no second source is registered. Similarly, fundamentals freshness is bounded by FMP's free-tier 250 req/day.

### 5.5 Documentation drift (erodes the platform's own AI-tooling premise)

This repo's context-engineering model depends on docs being trustworthy; three drifts found:

- `README.md:38-41` still lists `xstockstrat-trader`/`-insights`/`-config-ui` on ports 3000-3002 plus `xstockstrat-nginx:80` — all removed by feature 045 (consolidated UI, nginx deleted).
- `docs/runbooks/mcp-tools.md` claims eleven tools but documents ten (no `set_strategy_live` section; zero mentions of it), and shows `run_backtest` returning `{ "backtest_id": ... }` (line 256) when feature 064 changed it to return full results with per-symbol diagnostics.
- Runbook references `agent.oauth.client_id` / `allowed_redirect_uris` as "future" though the latter is a registered config key.

### 5.6 Roadmap hygiene

Duplicate feature numbers: `058-formula-parameters` + `058-watchlist-management` (both `launched` — numbers now immutable) and `064-backtest-debug-info` + `064-persist-strategy-scores` (both `code-completed`). Root `CLAUDE.md` prescribes renumbering the later collision to the next free NNN; the 064 pair is still renumberable, the 058 pair needs a documented exception.

---

## 6. Recommendations (prioritized)

| # | Priority | Recommendation | Maps to |
|---|---|---|---|
| R1 | **P0** | Ship broker-level protective exits before promoting any live-trading deployment: stop-loss/bracket orders. | 030 (`draft`) |
| R2 | **P0** | Close the MCP least-privilege gap: propagate the OAuth `user_id` as `x-user-id` downstream, derive scope from the user (drop hardcoded `x-access-scope: 7`), derive `manage_formula` authorship from the token, and make empty `MCP_AGENT_SECRET` fail-closed outside local dev. | New feature (security follow-up to 049) |
| R3 | **P1** | External alert fan-out (at minimum one push channel — Telegram or email). Unlocks the real value of 048's live alert engine. | 020 (`draft`) |
| R4 | **P1** | Position sizing engine; also unlocks emitting `INSUFFICIENT_CAPITAL` diagnostics. | 023 (`draft`) |
| R5 | **P1** | Close the results-trust loop: strategy performance dashboard + signal performance attribution, then walk-forward backtesting. | 031, 029, 032 (`draft`) |
| R6 | **P2** | Register a second OHLCV provider (Polygon or Tiingo) to de-risk Alpaca concentration — architecture already supports it. | `docs/runbooks/add-data-source.md` |
| R7 | **P2** | Document "no trading tools in the MCP agent" as explicit policy (runbook + agent CLAUDE.md) so the boundary is deliberate, not accidental. Consider a read-only agent watchlist tool for universe persistence. | — |
| R8 | **P2 (quick win)** | Fix doc drift: README service registry (post-045 topology), mcp-tools runbook (`set_strategy_live` section, 064 `run_backtest` return shape). | §5.5 |
| R9 | **P2 (quick win)** | Renumber one of the `064-*` features to the next free NNN; add a ledger/README note accepting the `058-*` collision. | §5.6 |
| R10 | **P2** | Surface auto-alert failures in `ingest_signal`'s response (`alert_emitted` flag) instead of log-only. | §5.4 |

---

## Appendix A — Method

- Audit target: `origin/main-dev` @ `b1ea0d4` (2026-07-09). Working-tree HEAD was 9 commits behind at session start; all findings were taken from or re-verified against `origin/main-dev`.
- Approach: three parallel read-only codebase surveys (MCP agent suite; UI + feature roadmap; proto/gRPC surface + data sources), followed by targeted verification of every claim quoted verbatim in this document (tool counts, lifecycle-status greps, README/runbook line references, `client.py` scope handling).
- No code was executed; no lifecycle statuses were changed.

## Appendix B — Feature status listing (computed from `feature.md` files @ `b1ea0d4`)

| Status | Features |
|---|---|
| `launched` (39) | 001-add-ikbr-account-support, 002-broker-accounts-ui, 003-formula-management-ui, 004-make-repo-public-secure, 005-frontend-reverse-proxy, 006-do-nginx-integration, 007-signal-source-weighting, 008-signal-source-registry, 009-agent-mcp-server, 011-remove-n8n-references, 012-wire-fe-auth, 013-phase-2-data-layer, 014-trader-chart-panel, 015-fix-grafana-otel-variables, 016-config-ui-weight-validation, 019-unified-login-page, 038-ci-docker-registry-deploy, 041-upgrade-nextjs15, 044-client-api-pattern, 045-ui-consolidation-nextjs, 046-align-frontend-e2e-bff-mocks, 047-strategy-engine, 048-live-strategy-alert-engine, 049-unify-admin-auth-gates, 050-strategy-creation-flow, 051-auth2-authorized-apps-ui, 052-durable-observable-backfills, 053-backfill-backtest-coverage, 054-resumable-chunked-backfills, 055-orders-management-ui, 056-open-positions-ui, 057-backfill-management-ui, 058-formula-parameters, 058-watchlist-management, 059-fundamentals-data-source, 060-screener-engine, 061-screener-agent-tool, 062-fundamentals-signal-producer, 063-fundamentals-scoring-model |
| `code-completed` (3) | 033-phase7-observability, 064-backtest-debug-info, 064-persist-strategy-scores |
| `draft` (11) | 010-agent-scheduler, 020-notify-external-fanout, 021-ledger-event-export, 022-signal-time-decay, 023-position-sizing-engine, 029-signal-performance-attribution, 030-stop-loss-bracket-orders, 031-strategy-performance-dashboard, 032-walk-forward-backtesting, 042-order-snapshots-pnl-patterns, 043-user-management-ui |
| `idea` (3) | 017-premarket-aftermarket-session-toggle, 039-timescaledb-compression, 040-timescaledb-retention |
| `demoted/canceled` (10) | 018-agent-mcp-oauth, 024-ml-price-prediction, 025-realtime-tick-streaming, 026-social-copy-trading, 027-crypto-exchange-integration, 028-mpt-portfolio-optimization, 034-options-trading-support, 035-sec-filing-sentiment, 036-portfolio-rebalancing, 037-multi-broker-smart-routing |

## Appendix C — Backend RPC inventory (11 services, `packages/proto/<domain>/v1/`)

| Service (port) | RPCs |
|---|---|
| `TradingService` (50051) | PlaceOrder, CancelOrder, ReplaceOrder, GetOrder, ListOrders, **StreamOrderUpdates**, RegisterBrokerAccount, ListBrokerAccounts, DeregisterBrokerAccount, UpdateBrokerAccountCredentials, GetTradingEnvironment |
| `PortfolioService` (50052) | GetPortfolio, ListPortfolios, GetPosition, ListPositions, GetPnL, GetSnapshot, **StreamPortfolioUpdates**, CreateWatchlist, GetWatchlist, ListWatchlists, UpdateWatchlist, DeleteWatchlist, AddWatchlistSymbols, RemoveWatchlistSymbols |
| `MarketDataService` (50053) | GetBars, GetLatestQuote, **StreamBars**, **StreamQuotes**, GetDataCoverage, ListAssets, BackfillBars, DeleteBackfilledData, GetFundamentals, GetFundamentalsMulti |
| `IndicatorsService` (50054) | ComputeIndicator, ExecuteFormula, ListIndicators, RegisterFormula, GetFormula, ListFormulas, UpdateFormula, DeleteFormula |
| `IngestService` (50055) | TriggerBackfill, GetBackfillStatus, ListBackfillJobs, CancelBackfill, NormalizeRawData, IngestSignal, QuerySignals, ListSignalSources, ManageSignalSource |
| `AnalysisService` (50056) | RunBacktest, ScoreStrategy, GetStrategyReport, ListStrategies, ManageStrategy, GetStrategy, ListStrategyDefinitions, SetStrategyLive, ScreenSymbols, RunFundamentalsScan |
| `LedgerService` (50057) | AppendEvent, QueryEvents, GetEvent, **StreamEvents** |
| `IdentityService` (50058) | AuthenticateUser, ValidateToken, RefreshToken, RevokeToken, RegisterOAuthClient, GetOAuthClient, IssueAuthCode, ExchangeAuthCode, RefreshOAuthToken, ListAuthorizedApps, RevokeAuthorizedApp |
| `NotifyService` (50059) | EmitAlert, AcknowledgeAlert, ListAlerts, **StreamAlerts** |
| `ConfigService` (50060) | GetConfig, SetConfig, ListKeys, **WatchConfig** |

Bold = server-streaming (the platform's entire real-time surface; no client-streaming or bidi RPCs exist).

## Appendix D — MCP agent tool inventory (`services/xstockstrat-agent/app/tools.py`, 11 tools)

| Tool | Backend | Notes |
|---|---|---|
| `list_signal_sources` | ingest | Credentials stripped; adds `extractor_tool` routing hint |
| `extract_email_content` | local (PyMuPDF/httpx) | Creds pulled from config service |
| `extract_website_content` | local (httpx) | Registered-source URL only |
| `ingest_signal` | ingest → notify | Auto-alert ≥ `agent.signal.alert_threshold`; alert failure log-only (§5.4) |
| `emit_alert` | notify | |
| `run_backtest` | analysis | Returns full diagnostics since 064 |
| `screen_symbols` | analysis | Read-only; no admin scope sent |
| `manage_strategy` | analysis | Hardcoded admin scope (§5.3) |
| `manage_formula` | indicators | Author from caller-supplied param (§5.3) |
| `manage_signal_source` | ingest | Hardcoded admin scope; `credentials_ref` never echoed |
| `set_strategy_live` | analysis | Hardcoded admin scope; missing from runbook (§5.5) |
