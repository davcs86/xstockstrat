# Changelog

All production promotions from `main-dev` to `main` are recorded here.
Each entry corresponds to one `main-dev → main` PR merge.

## 2026-08-24

### Features
- fix-backtest-annualized-return: `RunBacktest`'s aggregate `annualized_return` is ~30× under-scaled because it annualizes over the length of the concatenated multi-symbol equity curve (≈ N_symbols × window_days) instead of the run's real window span.
- manage-strategy-accept-object-rules: Widen the `manage_strategy` MCP tool's `entry_rule`/`exit_rule` params to accept a JSON **object** (dict) in addition to a JSON string, normalizing dicts to a JSON string in the agent wrapper, so any MCP client can register a strategy regardless of whether its transport pre-parses JSON-object arguments.
- backtest-portfolio-sizing: Replace the backtest engine's serial per-symbol equity compounding (a Π(1+rᵢ) parlay across symbols) with an opt-in real portfolio model — one shared capital pool, concurrent positions, a defined allocation policy, and a single portfolio equity curve — so aggregate `total_return` becomes a meaningful portfolio return rather than an ordering-dependent artifact.
- backtest-next-bar-fill: The backtest engine fills entries, exits, and the `vts` stop at the **same bar's close** — the very bar whose close produced the signal — a mild look-ahead / unrealistically-optimistic fill.
- market-regime-benchmark-operand: A strategy component gains an optional `source_symbol` so an indicator/formula can be computed on a fixed reference/benchmark symbol (e.g.

### Proto Changes
- analysis/v1/analysis.proto

### Summary
4 commits, 0 feature merges since last promotion.

---

## 2026-08-21

### Features
- mcp-watchlist-tools: Expose the existing `xstockstrat-portfolio` watchlist RPCs (feature 058/097/127) as new `xstockstrat-agent` MCP tools so an AI agent can list, read, create/update/delete watchlists and add/remove their symbols on behalf of the calling user.

### Summary
3 commits, 0 feature merges since last promotion.

---

## 2026-08-21

### Features
- notify-external-fanout: Adds HTTP fanout to the notify service so that platform alerts are delivered to Slack and/or email (SendGrid) in addition to the existing Connect-RPC stream, ensuring traders receive time-sensitive signal and fill notifications even when not viewing the UI.
- order-snapshots-pnl-patterns: At every order event (creation, fill, cancellation), capture a snapshot of the active indicator values, signals, and market conditions for the traded symbol.
- consolidate-watchlist-signal: Signals ingested via the MCP `ingest_signal` tool with `direction="watchlist"` are currently stored in `xstockstrat-ingest`'s `newsletter_signals` table as an inert label — `xstockstrat-analysis` treats them as non-actionable and nothing connects them to the platform's real, user-owned `xstockstrat-portfolio` `Watchlist` mechanism.
- config-secrets-and-scoping: Store platform secrets encrypted at rest in `xstockstrat-config` (AES-256-GCM) and serve them only through a new authenticated `GetSecret` RPC — never broadcast on `WatchConfig` or rendered at any consumer edge — then migrate the vendor API credentials out of `type: SECRET` env vars into that store, and re-model config scoping into exactly two dimensions: **environment** (`production`/ `staging`) × **global/per-user**, with paper/live derived from environment.

### Proto Changes
- analysis/v1/analysis.proto
- common/v1/common.proto
- config/v1/config.proto
- ledger/v1/ledger.proto
- portfolio/v1/portfolio.proto

### Summary
9 commits, 0 feature merges since last promotion.

---

## 2026-08-19

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as `secret.marketdata.fmp.api_key` — the only credential on the platform stored that way, and the only `is_secret = TRUE` row.
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums, but ts-proto encodes **camelCase** and (`stringEnums=true`) string enum constants.
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked for.
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28), a breaking rewrite: `FastMCP` → `MCPServer`, all 17 `@mcp.tool()` handlers gain an injected `ctx: Context` parameter, ASGI transport/mounting setup moves off the constructor (`mount_path` removed), `httpx`/`httpx-sse` are replaced by `httpx2`, the OAuth 2.1 edge-auth layer picks up several SEP-numbered behavior changes, and the protocol itself becomes stateless with no server-initiated back-channel (sampling/elicitation/roots deprecated).
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- shadcn-migration-custom-composites: Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the Combobox finding (already resolved by `119-shadcn-ui-migration` — verification only), consolidate the app's three independent charting approaches onto the official shadcn `Chart` primitive where the shape fits, extract a shared shadcn-primitive-based composite for the app's three repeatable-row editors (`OutputEditor`, `ParameterEditor`, `RuleEditor`'s condition builder), and adopt the shadcn `Questionnaire` primitive for `StrategyWizard`'s step shell.
- unified-symbol-page: Consolidate everything the platform already knows about a single stock symbol — position, orders, a trade-entry widget, opportunity/conviction and indicator/strategy signals and fundamentals (for watchlisted symbols), screening tools (for non-watchlisted symbols), backtest history, and backfill coverage — into one page, superseding the narrower `/trader/positions/[symbol]` and `/trader/orders/[id]` pages shipped by feature 096.
- fix-signal-detail-readiness-rule: On the Signal-detail page, a held opportunity tagged `Reduce` shows a header conviction sourced from the queue's **exit-rule** trace (e.g.
- symbol-page-section-nav: Group the many stacked sections of the unified Symbol page (`/trader/positions/[symbol]`, feature 125) into a same-page navigation pattern (tabs, sticky segmented section-nav, or anchored jump-links — decided at `/sdd-design`) so a trader can move between logical section groups without scrolling the whole page, on desktop and mobile.
- fix-listorders-ambiguous-updated-at: `TradingRepo.ListOrders`/`GetOrder`/`ListSubmittedOrders` fail on every call against staging Postgres with `column reference "updated_at" is ambiguous (SQLSTATE 42702)` and silently fall back to an in-memory store, because the `intentLateralJoinSQL` LATERAL join (feature 101) exposes a second unqualified `updated_at` column that the outer SELECT collides with.
- fix-opportunities-bars-fetch-oom: `_compute_opportunities`'s per-candidate bars-fetch call to `xstockstrat-marketdata` intermittently fails with Postgres `out of shared memory (SQLSTATE 53200)`, skipping affected symbols for that cycle's opportunity scoring/readiness trace.
- daily-bars-only: Strip platform-wide support for non-daily OHLCV timeframes (`15m`/`1h`): restrict `GetBars`/`BackfillBars`/the always-on bar ingester to `1d` only, and remove the UI's 15-minute/1-hour chart timeframe options — since no trading-path consumer (the live loop, screener technical criteria, default SMA strategy) ever evaluates anything but daily bars.
- fix-screener-soft-criterion: The screener's soft/weighted-criterion scoring (`ScreenerEngine._build_result`, `services/xstockstrat-analysis/app/services/screener.py:474`) falls back to a hardcoded neutral `0.5` `technical_score` whenever a candidate has zero usable data for every configured soft criterion (e.g.
- symbol-page-panel-refinements: Refine the trader symbol page (`/trader/positions/[symbol]`, feature 139's section-nav layout) so every section follows the Card/panel pattern, redundant broken panels are removed, Fundamentals is always-on, and a single user-controllable strategy selection drives the Indicators / Backtests / "Why this fired" panels so they are no longer dead-ends for symbols like AMZN.
- unify-symbol-chart-libraries: On the trader symbol page (`/trader/positions/[symbol]`), unify the presentation of the OHLCV price chart (`lightweight-charts`) and the indicator overlay panels (`recharts`) so they read as one instrument with a single, aligned time axis and a consistent visual language — resolving the follow-up left open by PR #980, which harmonized only the panels' card framing.

### Proto Changes
- analysis/v1/analysis.proto
- common/v1/common.proto
- marketdata/v1/marketdata.proto

### Summary
19 commits, 0 feature merges since last promotion.

---

## 2026-08-16

### Features
- signal-time-decay: Adds exponential confidence decay to the Opportunities queue's `signal_axis` ranking (`_compute_opportunities`) so a signal loses ranking weight as it ages, instead of ranking equally with a fresh signal until it expires.
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as `secret.marketdata.fmp.api_key` — the only credential on the platform stored that way, and the only `is_secret = TRUE` row.
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums, but ts-proto encodes **camelCase** and (`stringEnums=true`) string enum constants.
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked for.
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28), a breaking rewrite: `FastMCP` → `MCPServer`, all 17 `@mcp.tool()` handlers gain an injected `ctx: Context` parameter, ASGI transport/mounting setup moves off the constructor (`mount_path` removed), `httpx`/`httpx-sse` are replaced by `httpx2`, the OAuth 2.1 edge-auth layer picks up several SEP-numbered behavior changes, and the protocol itself becomes stateless with no server-initiated back-channel (sampling/elicitation/roots deprecated).
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- shadcn-migration-custom-composites: Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the Combobox finding (already resolved by `119-shadcn-ui-migration` — verification only), consolidate the app's three independent charting approaches onto the official shadcn `Chart` primitive where the shape fits, extract a shared shadcn-primitive-based composite for the app's three repeatable-row editors (`OutputEditor`, `ParameterEditor`, `RuleEditor`'s condition builder), and adopt the shadcn `Questionnaire` primitive for `StrategyWizard`'s step shell.
- live-strategy-opportunity-attribution: Attributes a held position or active signal in the Opportunities queue to a live-enabled strategy that already covers its symbol (via `signal_params.symbols`), instead of falling back to unattributed whenever the symbol isn't also watchlist-bound to that strategy.
- strategy-symbol-denylist: Replaces the opt-in `signal_params.symbols` allowlist per strategy with a deny list: a live-enabled strategy's evaluation universe becomes `union(watchlist-bound symbols, held-position symbols, active-signal symbols)` minus its own deny list, edited from both the Symbol detail page and the Strategy edit page, with denied `(symbol, strategy)` pairs surfaced as explicit skipped/muted rows in the Opportunities queue rather than silently disappearing.
- strategy-user-ownership: Makes `StrategyDefinition` user-owned: `strategy_id` becomes unique per-owner (not platform-wide), ownership gates every RPC that touches a strategy (including `RunBacktest`), and the live evaluation loop resolves each strategy's symbol universe (watchlist/held/signals) against its own owner — closing `132-strategy-symbol-denylist`'s cross-user-aggregation gap by construction instead of a new cross-user RPC.
- signal-source-reliability-weight: Makes signal-source reliability a first-class property of `ingest.SignalSource` and applies it when the analysis opportunities queue (`ListOpportunities`, feature 097) ranks candidates by `signal_axis`, which today uses raw unweighted `signal.conviction`.
- shadcn-datatable-migration: Migrate every table in `xstockstrat-ui` — native HTML markup, the shadcn `Table` primitive, or any other table implementation in use — to the shadcn `DataTable` pattern (`@tanstack/react-table` + `Table` primitive + column defs), and ensure every migrated table is horizontally responsive on narrow viewports (scrollable container, column priority, or stacked layout, as fits each table).
- fix-signal-detail-readiness-rule: On the Signal-detail page, a held opportunity tagged `Reduce` shows a header conviction sourced from the queue's **exit-rule** trace (e.g.

### Proto Changes
- analysis/v1/analysis.proto
- ingest/v1/ingest.proto

### Summary
13 commits, 1 feature merges since last promotion.

---

## 2026-07-30

### Features
- qa-capability: Replace the frontend-only `/test-data` fixture steward with a monorepo-wide QA capability: a read-only `qa-tester` subagent that designs tests, inventories coverage, and reports defects, plus a write-capable `sdd-qa` skill that writes tests, runs suites, detects flakes, and records defects to `docs/reports/` for `/sdd-triage --from-report`. (`code-completed`)

### Bug Fixes
- fix-backfill-timeframe-enum [SEV-2]: `ingest`'s `job_row_to_proto` populates only the deprecated `timeframe` string on every `BackfillJob` it returns and never sets `timeframe_enum`, so `GetBackfillStatus` and `ListBackfillJobs` always report `TIMEFRAME_UNSPECIFIED`. (`code-completed`)
- fix-fmp-config-boot-only [SEV-2]: `xstockstrat-marketdata` builds its FMP fundamentals client once at process boot, reading `marketdata.fmp.enabled` off a one-shot config fetch rather than the live `WatchConfig` stream every other config-driven behavior on the platform uses. (`code-completed`)

### Summary
8 commits, 0 feature merges since last promotion.

---

## 2026-08-14

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- shadcn-migration-custom-composites: Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the
- user-metadata-management: Add user profile metadata (email, phone, display name) to the identity service, with a self-management UI page under /config-ui and MCP agent tools for reading and setting metadata. Admins can manage their own profile only in this phase.

### Proto Changes
- identity/v1/identity.proto

### Summary
3 commits, 0 feature merges since last promotion.

---

## 2026-08-13

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- shadcn-migration-custom-composites: Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the
- fundamentals-provider-alternative: Replace (or add as a switchable alternative behind the existing `source.FundamentalsSource`

### Proto Changes
- marketdata/v1/marketdata.proto

### Summary
8 commits, 0 feature merges since last promotion.

---

## 2026-08-10

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- shadcn-migration-medium-confidence: Add four more shadcn-style primitives (Switch, Slider, Collapsible, Navigation Menu — the latter
- shadcn-migration-low-confidence: Evaluate the 4 low-confidence occurrences the shadcn/ui gap audit found — two one-line inline
- shadcn-migration-custom-composites: Fourth and final backlog feature from "The Component Ledger" shadcn/ui gap audit: close out the
- shadcn-table-actions-responsive: Fifth feature in the shadcn/ui migration lineage (119–123): adopt `DropdownMenu` for table "Actions"
- shadcn-sidebar-visual-rewrite: Follow-up to feature 124: bring the vendored, mobile-only offcanvas `Sidebar` (`PlatformHeader.tsx`)

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-08-09

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- shadcn-migration-high-confidence: Add ten missing shadcn-style primitives to `xstockstrat-ui`'s `src/components/ui/` (Tabs, Toggle

### Summary
-4 commits, 0 feature merges since last promotion.

---

## 2026-08-09

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- screener-fundamental-metric-selector: Replace the Screener page's free-text "Fundamental" metric-name field with a select dropdown
- screener-data-readiness-polling: When a Screener criterion (fundamental or technical) can't be evaluated because its underlying
- shadcn-ui-migration: Migrate `xstockstrat-ui` from Tailwind v3 to v4 and fully adopt shadcn/ui's official CLI tooling

### Proto Changes
- config/v1/config.proto

### Summary
8 commits, 0 feature merges since last promotion.

---

## 2026-08-07

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- watchlist-screen-improvements: Rework the `/insights/watchlists` detail pane: move per-symbol edit/delete actions into the
- fix-config-ui-env: The Config UI's ENV (dev/production) and MODE (paper/live) toggle presents both options as live,

### Summary
4 commits, 0 feature merges since last promotion.

---

## 2026-08-06

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).

### Summary
-2 commits, 1 feature merges since last promotion.

---

## 2026-08-06

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-08-04

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-08-03

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),
- fix-mcp-server-input-validation: Two small independent server guards: ingest range-validates conviction to INVALID_ARGUMENT (not INTERNAL/silent NULL), and notify rejects empty title/body (INVALID_ARGUMENT).
- opportunity-universe-unification: Unify the three symbol-origins that feed the Decide → Opportunities queue (active signals, held
- remove-x-mcp-secret-header: Remove the unenforced `x-mcp-secret` gRPC metadata header that `xstockstrat-agent` currently
- screener-watchlist-fidelity: Raise the Screener and Watchlists pages to the feature-083 "Nocturne" high-fidelity design using

### Proto Changes
- analysis/v1/analysis.proto
- portfolio/v1/portfolio.proto

### Summary
6 commits, 0 feature merges since last promotion.

---

## 2026-08-02

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),

### Summary
-4 commits, 0 feature merges since last promotion.

---

## 2026-08-02

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- mcp-python-sdk-v2-upgrade: Upgrade `xstockstrat-agent` from the Python `mcp` SDK v1.27.1 to v2.0.0 (released 2026-07-28),

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-08-01

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- ui-revamp-opportunities-first: Re-frame the `xstockstrat-ui` web app around a ranked **opportunity queue** — a Decide / Discover /

### Proto Changes
- analysis/v1/analysis.proto
- ingest/v1/ingest.proto
- portfolio/v1/portfolio.proto

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Features
- fix-grafana-otel-variables: Fixes OTel env var configuration across docker-compose.yml and DigitalOcean app specs — runtime derivation of resource attributes in all 13 service telemetry modules, unified env var naming (OTEL_EXPORTER_OTLP_*), and SERVICE_NAME normalization. (`code-completed`)

### Summary
1 commit, 1 feature merge since last promotion.

---

## 2026-07-29

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- mcp-config-management: Add MCP tools to `xstockstrat-agent` that read and write `xstockstrat-config` values
- fix-config-write-authz: `xstockstrat-config`'s `SetConfig` RPC performs no authorization check at all, and
- fix-config-value-roundtrip: Two related defects in `xstockstrat-config`, both blocking feature 073:
- fmp-key-to-secret-env: Feature 059 routed the FMP API key through `xstockstrat-config` as
- fix-listkeys-wire-encoding: `ConfigService.ListKeys` built its response with **snake_case** field names and **numeric** enums,
- fix-config-scope-resolution: `ConfigService` resolved **every** request to the `('dev', 'all')` scope, whatever the caller asked
- remove-mcp-sse-transport: Retire the legacy HTTP+SSE MCP transport (`/sse` + `POST /messages`) from `xstockstrat-agent`,

### Summary
10 commits, 0 feature merges since last promotion.

---

## 2026-07-27

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- strategy-partial-update: Make `manage_strategy` "update" apply a **partial merge** instead of a destructive full-replace, so
- backtest-time-window: Let the `run_backtest` **MCP tool** accept an explicit `start`/`end` window, and make the engine load
- backtest-result-attachment: Make the `run_backtest` MCP tool return a **compact inline summary plus an attached file** carrying

### Proto Changes
- analysis/v1/analysis.proto

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-07-24

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- strategy-reentry-cooldown: Add a configurable per-strategy re-entry cooldown (default 31 calendar days, chosen to sit outside

### Proto Changes
- analysis/v1/analysis.proto

### Summary
-3 commits, 0 feature merges since last promotion.

---

## 2026-07-24

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- backtest-results-visualization: Make past backtest runs fully visualizable in the insights UI: persist each run's detailed

### Proto Changes
- analysis/v1/analysis.proto

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-07-20

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- cross-stock-score-derivation: Replace the last-run-wins strategy headline score with a statistically robust derivation over

### Proto Changes
- analysis/v1/analysis.proto

### Summary
4 commits, 1 feature merges since last promotion.

---

## 2026-07-12

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- backtest-debug-info: Surface full day-by-day backtest diagnostics — per-bar OHLCV, computed indicator series, warm-up
- persist-strategy-scores: Persist strategy scores computed by `ScoreStrategy` in `xstockstrat-analysis` to a DB-backed

### Proto Changes
- analysis/v1/analysis.proto
- indicators/v1/indicators.proto

### Summary
11 commits, 0 feature merges since last promotion.

---

## 2026-06-30

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-06-30

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-06-29

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- watchlist-management: Persist user-defined watchlists (named symbol groups) in `xstockstrat-portfolio` with gRPC CRUD,
- fundamentals-data-source: Add Financial Modeling Prep (FMP) as a fundamentals data source in `xstockstrat-marketdata` via a new
- screener-engine: Add an on-demand `ScreenSymbols` RPC to `xstockstrat-analysis` that ranks a symbol universe against
- screener-agent-tool: Expose `ScreenSymbols` (Feature 060) as an MCP tool in `xstockstrat-agent`, mirroring the existing
- fundamentals-signal-producer: A scheduled job in `xstockstrat-analysis` that, for a deduplicated symbol universe, reads cached
- fundamentals-scoring-model: The concrete value-plus-quality composite that turns a symbol's raw fundamentals into a single 0–1

### Proto Changes
- analysis/v1/analysis.proto
- marketdata/v1/marketdata.proto
- portfolio/v1/portfolio.proto

### Summary
8 commits, 0 feature merges since last promotion.

---

## 2026-06-26

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Proto Changes
- identity/v1/identity.proto
- portfolio/v1/portfolio.proto

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-06-15

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Proto Changes
- ledger/v1/ledger.proto
- trading/v1/trading.proto

### Summary
9 commits, 0 feature merges since last promotion.

---

## 2026-06-12

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Proto Changes
- common/v1/common.proto
- marketdata/v1/marketdata.proto

### Summary
-6 commits, 0 feature merges since last promotion.

---

## 2026-06-12

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.
- orders-management-ui: A dedicated trader-segment UI page for full order lifecycle management — create, edit
- open-positions-ui: Upgrade the trader-segment Positions page to a paginated, filterable open-positions view
- backfill-management-ui: A dedicated UI page to manage per-ticker historical backfills — create, monitor live

### Proto Changes
- indicators/v1/indicators.proto
- ingest/v1/ingest.proto
- marketdata/v1/marketdata.proto
- portfolio/v1/portfolio.proto
- trading/v1/trading.proto

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-06-11

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Summary
-6 commits, 0 feature merges since last promotion.

---

## 2026-06-11

### Features
- phase7-observability: Completes the pending Phase 7 implementation roadmap item: activates the OTel SDK already stubbed in every service, routes telemetry to Grafana Cloud via the OTLP collector, and delivers service health, latency, and signal pipeline throughput dashboards — providing operational visibility before live capital is at risk.

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-06-09

### Features
- durable-observable-backfills: Make historical-backfill jobs durable and observable: persist job state to a new
- backfill-backtest-coverage: Make backtests aware of data coverage. Add a `GetDataCoverage` RPC on `xstockstrat-marketdata`,
- resumable-chunked-backfills: Make large backfills scale and survive interruption: split a job into server-side chunks

### Proto Changes
- analysis/v1/analysis.proto
- common/v1/common.proto
- indicators/v1/indicators.proto
- ingest/v1/ingest.proto
- marketdata/v1/marketdata.proto

### Summary
6 commits, 0 feature merges since last promotion.

---

## 2026-06-08

### Features
- auth2-authorized-apps-ui: Add a per-user **"My Authorized Apps"** management module (new `/accounts` segment in `xstockstrat-ui`) that lets an operator list, audit, and **revoke** the OAuth apps (e.g. Claude.ai) they've authorized against the xstockstrat MCP agent, plus connect a new one. Extends feature `049-unify-admin-auth-gates`'s identity OAuth backend with additive list/revoke RPCs + a per-user linkage migration (049 shipped no list and no revocation).

### Proto Changes
- identity/v1/identity.proto

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-06-07

### Summary
-8 commits, 0 feature merges since last promotion.

---

## 2026-06-07

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.
- unify-admin-auth-gates: **Unify agent auth across both layers** (working title: *unify-agent-auth*; directory slug retained for
- strategy-creation-flow: Adds a full strategy authoring UI to the `/insights` segment so operators can create, update, deactivate, and toggle live evaluation for strategies directly in the browser — achieving parity with the `manage_strategy`, `manage_formula`, and `set_strategy_live` MCP agent tools.

### Proto Changes
- identity/v1/identity.proto

### Summary
10 commits, 0 feature merges since last promotion.

---

## 2026-06-06

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.
- strategy-engine: Make **Strategy** a first-class, persisted entity in `xstockstrat-analysis`: a named definition
- live-strategy-alert-engine: Continuously evaluate **active strategies** (defined by feature `047-strategy-engine`) against the

### Proto Changes
- analysis/v1/analysis.proto

### Summary
4 commits, 0 feature merges since last promotion.

---

## 2026-06-05

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Proto Changes
- trading/v1/trading.proto

### Summary
1 commits, 1 feature merges since last promotion.

---

## 2026-06-05

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-06-04

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
-3 commits, 0 feature merges since last promotion.

---

## 2026-06-04

### Features
- formula-management-ui: Persist indicator formulas to TimescaleDB so they survive service restarts, scope them to the owning user (`author = user_id`), and add a full CRUD management UI inside `xstockstrat-insights`.
- config-ui-weight-validation: Add client-side validation to the config-ui weight editor so that JSON weight map keys (e.g. `analysis.signals.source_weights`) reject values outside `[0.0, 1.0]` before calling `SetConfig`, giving operators immediate feedback instead of silently-clamped server-side results.
- unified-login-page: Replaces the three per-basePath login pages in the consolidated `xstockstrat-ui` (after 045) with a single shared login page at `/auth/login`, redirecting all unauthenticated requests regardless of which basePath they originate from, and adapting identity's OAuth login form (from 018) to use the unified page.
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Proto Changes
- config/v1/config.proto
- indicators/v1/indicators.proto

### Summary
-4 commits, 0 feature merges since last promotion.

---

## 2026-06-04

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.
- client-api-pattern: Standardise the **client-side** API layer across all three Next.js frontends (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui): replace SWR with a single typed data-fetching + cache-normalization stack (library choice deferred to review), wrap every read and write in named typed hooks backed by generated `@xstockstrat/proto` types, and eliminate `any` from request/response boundaries. The server-side Connect-RPC clients are already typed with `@xstockstrat/proto`, so this feature is scoped to the client→route-handler boundary only.
- ui-consolidation-nextjs: Consolidate the three Next.js frontend services (trader, insights, config-ui) into a single Next.js service and remove the nginx reverse proxy, reducing infrastructure costs from 4 containers to 1 while preserving all existing basePaths, auth, observability, and agent SSE proxying.
- align-frontend-e2e-bff-mocks: Realign the Next.js frontend Playwright e2e backend mocks (trader, insights, config-ui) with the connect-web → BFF → backend gRPC architecture introduced by `044-client-api-pattern`, so CI validates the unified API pattern end-to-end instead of pointing at endpoint env vars that runtime code no longer reads.

### Summary
9 commits, 0 feature merges since last promotion.

---

## 2026-06-02

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.
- client-api-pattern: Standardise the **client-side** API layer across all three Next.js frontends (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui): replace SWR with a single typed data-fetching + cache-normalization stack (library choice deferred to review), wrap every read and write in named typed hooks backed by generated `@xstockstrat/proto` types, and eliminate `any` from request/response boundaries. The server-side Connect-RPC clients are already typed with `@xstockstrat/proto`, so this feature is scoped to the client→route-handler boundary only.
- align-frontend-e2e-bff-mocks: Realign the Next.js frontend Playwright e2e backend mocks (trader, insights, config-ui) with the connect-web → BFF → backend gRPC architecture introduced by `044-client-api-pattern`, so CI validates the unified API pattern end-to-end instead of pointing at endpoint env vars that runtime code no longer reads.

### Summary
3 commits, 0 feature merges since last promotion.

---

## 2026-06-01

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.
- client-api-pattern: Standardise the **client-side** API layer across all three Next.js frontends (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui): replace SWR with a single typed data-fetching + cache-normalization stack (library choice deferred to review), wrap every read and write in named typed hooks backed by generated `@xstockstrat/proto` types, and eliminate `any` from request/response boundaries. The server-side Connect-RPC clients are already typed with `@xstockstrat/proto`, so this feature is scoped to the client→route-handler boundary only.

### Summary
6 commits, 0 feature merges since last promotion.

---

## 2026-06-01

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-06-01

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
-5 commits, 0 feature merges since last promotion.

---

## 2026-06-01

### Features
- upgrade-nextjs15: Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js 15.x (the version already used by `xstockstrat-trader`). The current workaround for the pnpm workspace standalone path issue (subdirectory CMD and static COPY paths) works correctly but leaves two services on an older, unsupported Next.js major version. Upgrading aligns all three frontends on the same major version and eliminates the version split.

### Summary
6 commits, 0 feature merges since last promotion.

---

## 2026-05-30

### Summary
-14 commits, 0 feature merges since last promotion.

---

## 2026-05-30

### Summary
16 commits, 0 feature merges since last promotion.

---

## 2026-05-29

### Summary
-18 commits, 0 feature merges since last promotion.

---

## 2026-05-29

### Summary
20 commits, 0 feature merges since last promotion.

---

## 2026-05-28

### Summary
29 commits, 0 feature merges since last promotion.

---

## 2026-05-27

### Features
- ci-docker-registry-deploy: Move Docker image builds from DigitalOcean's infrastructure into GitHub Actions CI, push images to a container registry, and configure DO App Platform to deploy pre-built images. This surfaces build failures at PR time rather than during deployment and eliminates cold `pnpm install + pnpm build` runs on DO for every deploy.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-27

### Features
- ci-docker-registry-deploy: Move Docker image builds from DigitalOcean's infrastructure into GitHub Actions CI, push images to a container registry, and configure DO App Platform to deploy pre-built images. This surfaces build failures at PR time rather than during deployment and eliminates cold `pnpm install + pnpm build` runs on DO for every deploy.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-26

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-26

### Summary
0 commits, 0 feature merges since last promotion.

---

## 2026-05-26

### Summary
4 commits, 0 feature merges since last promotion.

---

## 2026-05-25

### Summary
0 commits, 0 feature merges since last promotion.

---

## 2026-05-25

### Features
- agent-mcp-server: Phase 1 of the AI agent service: a new Python MCP server (`xstockstrat-agent`) that exposes platform capabilities as MCP tools, enabling an operator to manually trigger AI-assisted signal extraction workflows from Claude.ai with no scheduler or automation infrastructure. Prerequisite: signal-source-registry (008).

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-24

### Features
- trader-chart-panel: Add an OHLCV candlestick chart panel to the `xstockstrat-trader` UI. The chart polls `GetBars` on a configurable interval (no streaming required given 5m minimum timeframe) and supports a symbol selector and timeframe switcher (1m, 5m, 15m, 1h, 1d). Backend RPCs, service logic, and DB layer are fully implemented — only the frontend component is missing.

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-05-24

### Features
- trader-chart-panel: Add an OHLCV candlestick chart panel to the `xstockstrat-trader` UI. The chart polls `GetBars` on a configurable interval (no streaming required given 5m minimum timeframe) and supports a symbol selector and timeframe switcher (1m, 5m, 15m, 1h, 1d). Backend RPCs, service logic, and DB layer are fully implemented — only the frontend component is missing.

### Summary
2 commits, -1 feature merges since last promotion.

---

## 2026-05-24

### Summary
2 commits, 2 feature merges since last promotion.

---

## 2026-05-24

### Features
- signal-source-weighting: Add per-source reliability weights to the signal aggregation in the analysis service so that higher-trust sources (e.g. Goldman) have proportionally more influence on the combined conviction score than low-quality newsletters. Weights are configurable via the config service without code changes.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-23

### Summary
-1 commits, -1 feature merges since last promotion.

---

## 2026-05-23

### Summary
2 commits, 1 feature merges since last promotion.

---

## 2026-05-22

### Features
- signal-source-registry: Add a DB-backed signal source registry to the ingest service that defines all valid sources, their types (simple_email, email_attachment, linked_email, simple_website, authenticated_website), and per-source Python extractor modules. The registry enforces canonical source slugs across ingest and analysis, and is a prerequisite for the AI agent feature and signal-source-weighting (007).

### Proto Changes
- ingest/v1/ingest.proto

### Summary
12 commits, 3 feature merges since last promotion.

---

## 2026-05-22

### Features
- phase-2-data-layer: `GetPnL` in `xstockstrat-portfolio` always returns `realized_pnl = 0` because the service never queries the ledger for closed-position fills. The root cause is in `xstockstrat-trading`: neither broker engine (`AlpacaClient` nor `IBKRClient`) populates `FilledAvgPrice` in `BrokerOrder`, so `order.filled` ledger events are always emitted with `fill_price = 0.0`. This feature fixes both bugs: the trading service broker/pollFills root cause, and the portfolio service GetPnL ledger-query gap.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-16

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-21

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-20

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-20

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-19

### Features
- wire-fe-auth: Wire the fully-built `xstockstrat-identity` service into all three Next.js frontends (trader, insights, config-ui) — adding login pages, route-protection middleware, JWT session management, and Bearer token injection on all Connect-RPC calls. Establish a standard `user_id` propagation convention for service-to-service gRPC calls.

### Summary
5 commits, 0 feature merges since last promotion.

---

## 2026-05-18

### Summary
0 commits, 0 feature merges since last promotion.

---

## 2026-05-18

### Features
- do-nginx-integration: Wire the nginx reverse proxy (established locally by feature 005-frontend-reverse-proxy) into the DigitalOcean App Platform deployment by updating `.do/app.yaml` and `.do/app.dev.yaml` so that the unified `/trader`, `/insights`, `/config-ui` routing is live in both dev and production environments.
- remove-n8n-references: Remove all n8n references from the codebase and documentation. Webhook endpoints used only by n8n (config, ledger, identity, trading, indicators) are deleted entirely — callers use Connect-RPC directly. Endpoints that serve the agent MCP server's ingestion goal (ingest, notify, analysis) are kept with the `/n8n/` path segment removed. The `packages/n8n/` directory is deleted and all docs updated.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-18

### Features
- do-nginx-integration: Wire the nginx reverse proxy (established locally by feature 005-frontend-reverse-proxy) into the DigitalOcean App Platform deployment by updating `.do/app.yaml` and `.do/app.dev.yaml` so that the unified `/trader`, `/insights`, `/config-ui` routing is live in both dev and production environments.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-16

### Summary
-4 commits, 0 feature merges since last promotion.

---

## 2026-05-12

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.
- frontend-reverse-proxy: Implement a production-ready nginx reverse proxy that routes all frontend requests from a unified public URL (`/trader`, `/insights`, `/config-ui`) and centralizes authentication, CORS, rate limiting, and security middleware across all three Next.js frontends.

### Summary
10 commits, 4 feature merges since last promotion.
---

## 2026-05-15

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-12

### Summary
-3 commits, -3 feature merges since last promotion.

---

## 2026-05-12

### Summary
2 commits, 1 feature merges since last promotion.

---

## 2026-05-12

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.
- make-repo-public-secure: Audit the xstockstrat repository for all hardcoded secrets, credentials, API keys, and sensitive configuration values, remove or replace them with environment variable references or safe placeholders, and update documentation to reflect public-repo best practices before making the repository public on GitHub.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-11

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-10

### Features
- broker-accounts-ui: Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.

### Summary
2 commits, 0 feature merges since last promotion.

---

## 2026-05-07

### Summary
1 commits, 0 feature merges since last promotion.

---

## 2026-05-06

### Summary
7 commits, 0 feature merges since last promotion.

---

## 2026-05-04

### Summary
1 commit, 0 feature merges since last promotion.
