# Product Spec: ui-revamp-opportunities-first

**Created**: 2026-07-31

---

## Problem Statement

Today's `xstockstrat-ui` is organized around three siloed segments (trader / insights / config-ui)
that mirror the platform's internal service boundaries and present the app primarily as a
**portfolio-monitoring** tool. But the broker (Alpaca / IBKR) already owns the ledger and P&L — the
app's real job is to surface *what to do next*. Traders have no single ranked surface that says
"here are the actionable buy / trim / exit signals your strategies, watchlists, and screener fired,
why each fired, and how to act on it in one confirmation." This feature re-frames the entire UI
around that **opportunity queue**, reproducing the high-fidelity "Nocturne" design handoff.

## User Story

As a xstockstrat trader, I want the web UI re-framed around a ranked opportunity queue — a unified
Decide / Discover / Engine / Book nav shell with an optional MCP-backed Copilot rail — instead of
portfolio monitoring, so that the broker owns P&L while xstockstrat surfaces ranked, explained
buy / trim / exit signals I can act on with one confirmation, faithfully reproducing the Nocturne
design system across all 12 handoff screens, the CRUD editors, and a 1:1 mobile companion.

## Design Reference

The authoritative visual + behavioral spec is the **design handoff bundle** committed alongside this
spec at [`design-handoff/`](design-handoff/):

- `design-handoff/README.md` — the design-system token table (Nocturne: `--color-bg #161826`,
  `--color-accent #9184d9` blurple, semantic `--gain #4cc79c` / `--loss #e0787a` / `--paper #c9b47e`,
  Inter + mono type, compact density), the shared screen "header grammar," the app-shell layout, the
  Copilot rail spec, per-screen breakdowns, interaction states, and the states-to-implement list
  (loading / empty / error / destructive-confirm).
- `design-handoff/source-map.md` — maps each screen to the real `services/xstockstrat-ui` modules it
  was derived from (the grounding starting points for `/sdd-spec`).
- `design-handoff/xstockstrat UI.dc.html` — the interactive prototype. Its bottom `<script> class
  Component` (the `*Stats`, `strategies`, `exposures`, `btBars`, `backfillJobs`, `portfolioAccounts`,
  `phones` arrays and `renderVals()` color logic) is the behavioral spec. **The HTML is a reference,
  not code to ship** — recreate each screen with the repo's existing `components/ui/*` primitives,
  data hooks, and Connect-RPC clients.
- `design-handoff/screenshots/01–12` — a reference capture of every screen (01–11 desktop, 12 mobile).

Fidelity is **hifi**: final colors, type, spacing, iconography, and interaction states are to be
reproduced faithfully, mapping Nocturne values to existing Tailwind tokens / CSS variables where a
token already exists rather than hard-coding hexes.

## Functional Requirements

### Shell & navigation

FR-1. **Unified app shell.** Replace the three-segment chrome with one shell: a `212px` left sidebar
(brand lockup + four labelled nav sections **Decide / Discover / Engine / Book**, each item with an
optional right-aligned count badge and a 3px accent active-mark), a `49px` sticky top bar
(breadcrumb `Module / Page`, account switcher, PAPER/LIVE mode tag, Copilot toggle), and a content
region. Nav sections and items per README §App Shell: Decide → Opportunities, Signal detail;
Discover → Watchlists, Screener; Engine → Strategies, Backtest, Signal sources, Backfills; Book →
Exposure, Portfolio, Orders. Sidebar footer shows a "Mobile companion →" affordance and a "Signal
engine live" status card.

FR-2. **Nav reachability.** Every screen listed above is reachable from the shared sidebar, and each
in-screen "→" affordance (e.g. Backtest "Backfill this range →", Portfolio "See risk in Exposure →",
Exposure "N exit flags in queue →") navigates to its target. The breadcrumb reflects the active
screen. _(Guards ledger `fails.md` 2026-07-01 060-screener-engine / Constitution C-10(a): a new UI
page must be registered in the shared nav with a nav-reachability test.)_

FR-3. **Nocturne design system.** Reproduce the Nocturne tokens (color roles, semantic
gain/loss/paper, Inter + mono typography, kicker-label eyebrow pattern, compact density, outlined
buttons, themed hover/active/focus states) faithfully. The app is **already dark-only** and
`tailwind.config.js` already defines custom `buy` / `sell` / `paper` colors, so map the Nocturne
gain / loss / paper and accent roles onto the existing `globals.css` `:root` variables +
`tailwind.config.js` rather than introducing a parallel token system (tokens live inline in those two
files — there is no separate token module). Numbers, tickers, IDs, thresholds, and timestamps render
in the mono stack with `tabular-nums`. Phosphor icons replace the prototype's hand-drawn inline SVG
stand-ins.

FR-4. **Copilot rail (MCP-backed) — SHALLOW BETA in 083.** An optional `310px` right rail, toggled from
the top bar (button shows an accent-filled active state when open), containing a "Read of the queue"
summary, a concentration-flag card with actions, an "asked earlier" thread, and a sticky input with
suggestion chips and an "MCP · N tools · read-only unless you confirm" note. Default off.
**Scope for 083 (design decision 2026-07-31):** the "Read of the queue" + concentration-flag cards are
**computed client-side** from the loaded queue + position weights (no LLM), and the thread persists via
the **ledger append-store** (`copilot:{user_id}:{thread_id}` streams, append-only). The input renders in
a **beta/read-only** state — it does **not** perform a live authenticated MCP tool call in 083.
**Deferred to a separate feature:** the authenticated MCP tool-invocation path (UI-as-OAuth-client →
agent-aud token → MCP JSON-RPC) and any LLM generation of the summary (see Out of Scope + design.md § 3).

### Screens (Decide / Discover / Engine / Book)

FR-5. **Opportunities (Decide) — the home queue.** A 5-stat row (Actionable now / Expiring <90m /
Exit-trim flags / Fresh entries / Deployable), source-filter chips (All / Portfolio / Watchlists /
Screener), a min-conviction slider, a sort control, and the ranked queue: each row = ticker, action
tag (ENTER/ADD = gain, TRIM = paper, EXIT/SELL = loss), conviction % (color-coded), thesis line,
40-point sparkline, change %, expiry, and per-signal "Review & add" / "Snooze" actions. Rows open
Signal detail.

FR-6. **Signal detail (Decide).** Why one signal fired + the order ticket. Left: symbol header, a
candlestick chart (timeframe tabs 5m/1H/1D/1W/1M, SMA overlay, target/stop dashed guides) and a
conditions list (name, live value, threshold, strength bar, pass = gain / soft = paper). Right: a
buy/sell segmented toggle, the order-ticket rows (Notional, Risk at stop, Position after, factor
exposure after) and a strategy track-record block. (Derived from `OrderForm.tsx`, `AlertStream.tsx`.)

FR-7. **Watchlists (Discover).** Left list of watchlists ("N ready" count, accent when > 0). Right:
that list's symbols — ticker, last, change %, a **readiness** bar + state (firing / N away /
watching / quiet), the blocking condition, the strategy, and an action ("In queue →" / "Alert me").
Header: "New list", "Build from screener". Watchlist editor: name + add-by-symbol (Enter / "+").

FR-8. **Screener (Discover).** Left rail: Universe select, a weighted Criteria list (metric, op,
threshold, weight bar, hard/rank tag), "+ Add criterion", and a Copilot suggestion card. Right:
ranked results table (rank, symbol, score, PE, RSI, rev growth, ATR, held?). Header: "Save as
watchlist", "Run scan". (Derived from `app/insights/screener/page.tsx`.)

FR-9. **Strategies (Engine).** A 5-stat row (Active strategies / Signals 30d / Blended hit rate /
Portfolio expectancy / Queue share), a table (strategy id, **State** tag, Signals 30d, Taken, Hit
rate, Expectancy, Max DD, 90-day equity sparkline, "Open →"), and a featured-strategy card
(equity-vs-SPY chart + diagnostics + Copilot read). **State vocabulary is Active / Paused / Off**
(NOT Live/Paper — that would collide with the account trading mode). Strategies have **no** Universe
field (universe belongs to the screener + signal sources). Strategy editor: Definition (Name, "what
it looks for", Horizon segmented Intraday/Swing/Position, State segmented Active/Paused/Off), entry/
exit condition builders, and a backtest preview. (Derived from `app/insights/strategies/page.tsx`.)

FR-10. **Backtest (Engine).** Config bar (Strategy / Symbols / Start / End / Timeframe) with "Run
history" + "Run backtest". A **coverage-gap notice** (loss-outlined) mirroring
`BACKTEST_STATUS_INSUFFICIENT_DATA` — the gap is the pre-window warm-up span, distinct from the
requested range — with a "Backfill this range →" button to Backfills. An equity-curve card
(normalized % per symbol, benchmark dashed line, entry/exit markers) + a diagnostics panel (CAGR,
Sharpe, Max drawdown, Avg hold, Slippage assumed, Trades/month). A **day-by-day debug table** mapping
`BarAction` (Warm-up = dim row, Flat/Hold = neutral, Buy = gain-tinted row, Sell = loss-tinted row)
with per-bar indicators, warm flag, and conviction. (Derived from `EquityCurveChart.tsx`,
`BacktestDiagnostics.tsx`, `useBacktest.ts`, `fixtures/backtests.ts`.)

FR-11. **Signal sources (Engine).** A 5-stat row (Sources live / Needs attention / Symbols covered /
Median latency / Strategies fed), a sources table (id, kind, symbols, freshness sparkline, health
bar, feeds count, live/stale tag) with a row-selected detail panel (status, freshness, health checks
with ok/warn/fail colors, recent log lines, a note, which strategies read it). Header: "Add source".
Source editor: endpoint, API key, universe, field mapping.

FR-12. **Backfills (Engine, admin-only).** An "ADMIN ONLY" header tag; create + delete panels gated
by `useIsAdmin()`. A 5-stat row, a "New backfill" card (Symbols / Timeframe / Start / End / "Start
backfill" + "Overwrite existing bars in range" checkbox), status + symbol filters with a "polling
every 4s" note, and a job list (per job: status tag, symbols, timeframe, progress bar with
"bars X/Y · chunks A/B", error line when present, job id; a **Cancel** button only for running/queued).
A **delete panel** (destructive) with typed-symbol confirmation and a "type DELETE ALL" whole-symbol
confirm gate. (Derived from `app/insights/backfills/page.tsx`, `useBackfills.ts`.)

FR-13. **Exposure (Book).** Framed as *risk, not P&L*. A 4-stat row (Total risk at stops / Largest
factor / Positions past target / Stops within 2%) and a table (symbol, qty, weight, Open R, Risk at
stop, stop-distance bar + %, exit rule, factor, and a flag: Add/Trim/Exit signal / Stop near). Header:
"N exit flags in queue →". (Derived from `app/trader/positions/page.tsx`, reframed to risk.)

FR-14. **Portfolio (Book) — read-only broker mirror.** A read-only mirror of what the brokers report
— Alpaca and IBKR own the ledger and P&L; **the app never writes to the ledger, and the UI states
this.** A 5-stat row (Combined equity / Cash / Buying power / Day P&L / Total P&L), two account cards
(Alpaca · Primary, IBKR · Long-term), a positions table (Symbol, Account, Qty, Avg cost, Mkt value,
Unrealized, Day P&L), and a "Balances refresh every 10s from the broker" footer note. (Derived from
`PortfolioPanel.tsx`, `usePortfolio.ts`, `fixtures/portfolios.ts`.) _(Broker-authoritative valuation
must be the sole source for these figures across every read path — ledger `fails.md` 2026-07-01
056-open-positions-ui / Constitution C-10(b).)_

FR-15. **Orders (Book).** A filterable table of today's orders (symbol, side BUY/SELL, type, qty,
filled, avg, **status** tag, origin strategy-or-Manual, time, action View/Edit/Why?) with each order
traced back to the signal that produced it. Header: "Back to queue", "New order". Order editor: side,
type, qty, limit/stop, order preview. (Derived from `OrderFilters.tsx`, `OrderBook.tsx`.)

FR-20. **Order-execution behavior unchanged (paper-safe re-presentation).** The Signal-detail order
ticket (FR-6), the Orders table (FR-15), and the order editor are a **re-presentation** of the
existing `OrderForm.tsx` / `OrderBook.tsx` surfaces — execution semantics are out of scope and must
not change. Specifically: (a) the confirmation surfaces behave **identically under `TRADING_MODE=paper`
and `live`** (paper-safe; dev is paper-only per the feature-workflow invariant) and carry the PAPER/LIVE
mode tag from FR-1; (b) **all existing `OrderType` values** (MARKET, LIMIT, STOP, STOP_LIMIT,
TRAILING_STOP) continue to render and submit as they do today — no order type is dropped or added; and
(c) both `ORDER_STATUS_PARTIALLY_FILLED` and `ORDER_STATUS_FILLED` render (partial-fill rows show
`filled < qty`), and streamed fill handling (FR-18) is unaffected. _(Addresses review warnings C-3 /
C-4 / C-5: this feature restyles, it does not alter trade execution or fill handling.)_

### Mobile & behavior

FR-16. **Mobile companion (1:1 parity).** One phone frame per desktop screen (11 total) in a
horizontal rail, each captioned with the desktop screen it mirrors, using one shared section renderer
(section kinds: `stat`, `signal`, `chart`, `row`, `form`, `note`, `action`, `head`) and a fixed
bottom tab bar (Decide / Discover / Engine / Book). **All tap targets ≥ 44px.** Implemented as the
same routes/screens in a responsive (or native) shell — full parity, not a reduced subset.

FR-17. **Non-happy-path states.** Every data screen implements loading (skeleton per card/table),
empty ("No backfill jobs match the filter", "No portfolio data", "No equity curve data for this
run"), and per-card error states, plus the destructive-confirm gating on the Backfills delete panel.

FR-18. **Live / polling data.** Reflect the real hooks' cadence in loading/stale UI: portfolio &
positions poll every 10s; backfill jobs poll every 4s while non-terminal and stop on terminal states
(completed / failed / partial / canceled); order updates stream.

FR-19. **Tweakable chrome props (app-level config, not per-user).** `density` (compact | comfortable),
`showCopilot` (boolean, default off), `accountMode` (paper | live). Surfaced as configuration, not
hardcoded — consistent with the platform's config-governance rules.

## Out of Scope

> **Scope override (user directive 2026-07-31, recorded in context.md § DECISION):** the original spec
> scoped this **UI-only** and deferred every backend gap to separate features. The user directed that
> **all backend gaps ship inside 083, sequenced backend→frontend, with no phased split.** The bullets
> below are updated accordingly; the enumerated backend subsystems and their ordering live in `design.md`.

- **No changes to backend trade execution, P&L computation, or the broker ledger of record.** The broker
  (Alpaca/IBKR) remains the system of record for positions and P&L; the app never writes to the broker
  ledger. (This is unchanged — the in-scope backend work below is *analytics/read* surfaces, not trade
  execution.)
- **IN SCOPE (per the override):** the backend RPCs/messages/enums + migrations that feed the revamped
  screens — the ranked Opportunity-queue RPC, live condition/readiness evaluation, position risk/factor
  fields, signal-source health, per-strategy analytics, and screener enrichment. Enumerated in
  `design.md` (five additive subsystems on an `analysis`-owns-the-queue spine; no new DB pool — F-06 held).
- **DEFERRED to a separate future feature — full Copilot.** 083 ships the Copilot **shallow beta** (FR-4:
  client-side summary + ledger-persisted thread, no live tool call). The **authenticated MCP
  tool-invocation path** (UI-as-OAuth-client → agent-aud token → MCP JSON-RPC) and any **LLM generation**
  are a separate `xstockstrat-agent` + UI feature (run `/sdd-story` to open it). 083 adds **no new agent
  tool** and **no agent DB**.
- **Live Alpaca/IBKR ledger writes** — explicitly excluded (Portfolio is read-only broker mirror).
- **Shipping the prototype HTML** — it is a reference only.
- **No new auth/authz beyond** the existing JWT middleware + `useIsAdmin()` gate and standard
  header-propagation (C-03) on the new RPCs. (The Copilot OAuth-client token surface is part of the
  deferred full-Copilot feature, not 083.)

## Affected Services

Exact service names from CLAUDE.md Service Registry. **Expanded from UI-only to multi-service by the
scope override** (backend gaps now in-scope):

- `xstockstrat-ui` (Next.js) — the full UI revamp: all 12 screens, the shell, the Copilot **shallow-beta**
  rail, the CRUD editors, and the mobile companion, using existing `components/ui/*` primitives, TanStack
  Query hooks, and Connect-RPC BFF clients; plus new BFF routes/browser clients for the new backend RPCs.
- `xstockstrat-analysis` (Python) — new `ListOpportunities`, `EvaluateReadiness`, `GetStrategyAnalytics`
  RPCs; `ScreenResult` enrichment; additive evaluator sibling for the traced readiness/conviction. Owns
  the opportunity-queue aggregation (already dials ingest/portfolio/indicators — zero new edges for the
  queue); new **non-cyclic** `analysis→trading` edge for "taken".
- `xstockstrat-ingest` (Python) — signal-source **health** fields/enum + **migration 008** on
  `signal_sources`; the queue reads its existing `QuerySignals`.
- `xstockstrat-portfolio` (Go) — `Position` **risk/factor** fields + `PositionRiskFlag` enum + factor
  grouping (marketdata `sector`); resting-stop learned via a **ledger order-event** (no `portfolio→trading`
  cycle).
- `xstockstrat-ledger` (Node) — **no code change**; used as the append-store for Copilot threads
  (`AppendEvent`/`QueryEvents`, existing RPCs — no new pool, F-06 held).
- Proto package `packages/proto/{analysis,portfolio,ingest}/v1` — one additive, non-breaking proto pass
  (new messages/RPCs + four enums, each `_UNSPECIFIED=0`) + `buf-gen` codegen.

Not modified in 083: `xstockstrat-agent` (no new tool; full Copilot deferred), `trading` (read-only
consumer via `ListOrders` / order-events; no change), `marketdata`, `indicators` (existing
`ComputeIndicator` reused — note the close-only ATR/VWAP approximation caveat), `config`, `notify`,
`identity`.

## Proto Contract Changes

- [x] **Proto changes REQUIRED** (scope override — backend in-scope). One **additive, non-breaking** pass:
  - `analysis`: `ListOpportunities`+`Opportunity`+`OpportunityActionTag{UNSPECIFIED,ENTER,ADD,REDUCE}`;
    `EvaluateReadiness`+`SymbolReadiness`+`ConditionEval`+`ConditionState{UNSPECIFIED,PASS,SOFT,FAIL}`;
    `GetStrategyAnalytics`+`StrategyAnalytics`; new `ScreenResult` fields (raw pe/rsi/atr/rev_growth/held).
  - `portfolio`: `Position` risk fields + `PositionRiskFlag{UNSPECIFIED,ADD_SIGNAL,REDUCE_SIGNAL,STOP_NEAR}`.
  - `ingest`: `SignalSource` health fields + `SourceHealthStatus{UNSPECIFIED,LIVE,STALE,DOWN}`.
  - Each enum has `_UNSPECIFIED=0` (C-04). Gate: `buf lint` + `buf breaking` + `./scripts/buf-gen.sh`
    freshness (C-09). Approval: **2 proto owners + platform lead** (see workflow gates below).

> Enum-map caveat (ledger `fails.md` 2026-07-21 / C-10(a/d)): the four enums above are **new types**, so no
> existing `BacktestDiagnostics.tsx` exhaustive `Record<Enum,…>` breaks `tsc`. But each new enum MUST ship
> its own exhaustive TS `Record<Enum,…>` render map (+ a `default` case for any string-`direction` map) in
> the **same PR** that introduces it — authored, not appended.

## Config Key Changes

- [x] **FR-19 chrome props resolved (design decision):** `density`, `showCopilot`, `accountMode` are served
  via **env-overridable defaults + a `ChromeContext`** (reusing `AccountContext` for `accountMode`), **not**
  `xstockstrat-config` keys. This records a **C-05 deviation** (env defaults over config-service keys for
  three presentation toggles; rationale in context.md) — **not** an F-07 breach, conditional on the defaults
  being env-overridable, not bare source literals.
- [ ] **Conditional new key:** `portfolio.exposure.factor_map` (JSON) — only if marketdata fundamentals does
  **not** expose `sector` for factor grouping (verify at `/sdd-spec`, design.md Open Risk). If added: follows
  `<service>.<category>.<key>` naming, documented in `services/xstockstrat-portfolio/CLAUDE.md` + the
  Per-Feature Registered Keys log, config-team review.

## Database Changes

- [x] **Schema change REQUIRED** (scope override): `xstockstrat-ingest` **migration 008** on
  `ingest.signal_sources` (source-health columns: freshness / last-seen / last-error / status). DBA +
  ingest-owner review.
- [ ] **Conditional:** `xstockstrat-portfolio` stop-state storage (a column for ledger-derived resting
  stops) and/or an `xstockstrat-analysis` expectancy column — **only if** compute-on-read/`backtest_runs`
  proves insufficient at `/sdd-spec` (design.md Open Risks). No Copilot migration (ledger append-store).

## Feature Workflow Notes

Branch to create: `feature/ui-revamp-opportunities-first` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md) — **expanded by the scope override:**
- [x] Service-owner approvals — `xstockstrat-ui`, `xstockstrat-analysis`, `xstockstrat-ingest`,
  `xstockstrat-portfolio` owners (+ `xstockstrat-ledger` owner FYI for the Copilot append-store usage,
  `trading` owner FYI for the `ListOrders`/order-event read).
- [x] **2 proto owners + platform lead** — the additive proto pass (analysis/portfolio/ingest).
- [x] **DBA review + service owner** — ingest migration 008 (+ any conditional portfolio/analysis column).
- [ ] Config team — only if `portfolio.exposure.factor_map` is added.

Given the size (12 screens + shell + Copilot beta + mobile + editors **+ five backend subsystems**), the
feature is executed as **ordered per-`/sdd-spec` + `/sdd-execute` slices, backend→frontend** (design.md
§ Ordering). **Step PRs target the feature branch directly, not base-chained** (ledger fails.md 082).

## Acceptance Criteria

1. The unified Decide / Discover / Engine / Book shell renders with the left sidebar, top bar
   (breadcrumb, account switcher, mode tag, Copilot toggle), and content region, and **every** screen
   is reachable from the sidebar — asserted by a nav-reachability e2e test (Playwright).
2. All 12 handoff screens are reproduced to hifi fidelity against `design-handoff/screenshots/01–12`,
   using existing `components/ui/*` primitives and the repo's data hooks (no prototype HTML shipped).
3. Nocturne tokens (color roles, semantic gain/loss/paper, mono numerics with `tabular-nums`, kicker
   labels, outlined buttons, themed hover/active/focus states) are applied via
   Tailwind/CSS-variable tokens; Phosphor icons replace the prototype's inline-SVG stand-ins.
4. The Copilot rail opens/closes from the top bar with the correct active state, defaults off, and its
   footer states "read-only unless you confirm."
5. Strategy state renders as Active / Paused / Off (never Live/Paper); the strategy editor has **no**
   Universe field.
6. Backtest shows the coverage-gap notice for `BACKTEST_STATUS_INSUFFICIENT_DATA` runs with a working
   "Backfill this range →" jump, and the day-by-day debug table color-codes `BarAction` rows and
   conviction as specified.
7. Backfills is admin-gated (`useIsAdmin()`): the create + delete panels render only for admins, the
   delete panel enforces the typed-symbol and "DELETE ALL" confirmations, and job cards poll every 4s
   until terminal.
8. Portfolio is a read-only broker mirror — figures come from the broker-authoritative source, the
   footer states "xstockstrat never writes to the ledger," and balances reflect the 10s poll. A
   **cross-read-path parity test** asserts that any position valuation shown on both Portfolio
   (Mkt value / Unrealized) and Exposure (Risk at stop / weight) resolves to the *same*
   broker-authoritative source for the same symbol — closing the `ListPositions ↔ ListPortfolios`
   divergence seam from ledger `fails.md` 2026-07-01 056 / Constitution C-10(b).
9. Loading, empty, and error states are implemented for every data screen (skeletons, empty copy,
   per-card error notices).
10. The mobile companion renders 1:1 with every desktop screen via the shared section renderer, with a
    bottom tab bar and all tap targets ≥ 44px.
11. CI green: `pnpm lint`, `tsc`/`pnpm build`, vitest logic tests (`src/lib/**`), and the Playwright
    e2e suite (including the new nav-reachability + per-screen tests); coverage ≥ the `xstockstrat-ui`
    threshold.

## Open Questions — RESOLVED by `/sdd-design` (2026-07-31); detail in `design.md`

- [x] **Scope split.** RESOLVED by user override: **no split — all backend gaps ship in 083**, ordered
  backend→frontend. recon.md mapped every screen field to a producer and grep-verified each gap (guards
  fails.md 080/081). Full Copilot invocation is the one carve-out → a separate future feature.
- [x] **Config vs env for chrome props.** RESOLVED: **env-overridable defaults + `ChromeContext`** (C-05
  deviation recorded; not an F-07 breach). See Config Key Changes.
- [x] **Routes / URL compatibility.** RESOLVED: **keep** the `/trader|/insights|/config-ui|/accounts`
  prefixes; the four-tab nav is a presentation grouping, breadcrumb driven by the grouping; new Decide
  routes under `/insights`. No middleware-matcher / DO-route / bookmark churn.
- [x] **Copilot data source.** RESOLVED: **client-side** summary/concentration-flag (no LLM) + **ledger**
  thread persistence (no new pool). Live authenticated MCP tool invocation is **deferred** (shallow beta
  in 083 — FR-4).
- [x] **Nocturne tokens vs existing theme.** RESOLVED: **two-file token remap** of `globals.css:6-27` +
  `tailwind.config.js:40-42` (app already dark-only); add mono `fontFamily` + `tabular-nums`; additive
  Phosphor, per-screen lucide retirement.
- [x] **The `accounts` segment.** RESOLVED: hosted on a pinned **top-bar account/settings surface** that the
  **C-10(a) nav-reachability test walks** (asserts `authorized-apps`/`mcp-tools` reachable from the rendered
  shell — guards fails.md 060).
- [x] **Signal sources & watchlist backing.** RESOLVED: recon confirmed the existing hooks do **not** return
  readiness/blocking-condition/health — those are backend GAPs now filled by `EvaluateReadiness` (readiness)
  and ingest source-health (migration 008), consumed by the new screens.
