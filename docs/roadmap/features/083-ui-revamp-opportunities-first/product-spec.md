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

FR-4. **Copilot rail (MCP-backed).** An optional `310px` right rail, toggled from the top bar (button
shows an accent-filled active state when open), containing a "Read of the queue" summary, a
concentration-flag card with actions, an "asked earlier" thread, and a sticky input with suggestion
chips and an "MCP · N tools · read-only unless you confirm" note. Default off.

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

- **No changes to backend trade execution, P&L computation, or the ledger.** The broker remains the
  system of record; this feature is a presentation-layer re-frame that consumes existing RPCs.
- **New backend RPCs / proto messages** to feed a screen that has no existing data source. If
  `/sdd-design` finds a screen needs data no current RPC returns (e.g. a persisted Copilot thread, or
  a "readiness" computation not currently served), that backend work is a **separate feature** — this
  one is scoped to the UI. The design phase decides the split.
- **The MCP agent's tool contract.** The Copilot rail *consumes* the existing MCP surface; it does not
  add or change agent tools. Any new tool is a separate `xstockstrat-agent` feature.
- **Live Alpaca/IBKR ledger writes** — explicitly excluded (Portfolio is read-only).
- **Shipping the prototype HTML** — it is a reference only.
- Authentication / authorization changes beyond reusing the existing JWT middleware and `useIsAdmin()`
  gate.

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-ui` (Next.js) — **the entire change.** All 12 screens, the shell, the Copilot rail, the
  CRUD editors, and the mobile companion are rebuilt/re-framed here using the existing
  `components/ui/*` primitives, TanStack Query hooks, and Connect-RPC BFF clients.

No other service is modified by the in-scope work. The UI continues to reach backend services
(trading, portfolio, marketdata, analysis, indicators, ingest, config, notify) over the existing
gRPC/Connect BFF; the Copilot rail reaches the existing `xstockstrat-agent` MCP surface. Should the
design phase surface a required backend data gap, that becomes its own feature (see Out of Scope).

## Proto Contract Changes

- [x] No proto changes required (in-scope UI-only work).

> Caveat for `/sdd-design`: if a screen provably needs data no existing RPC returns, the proto/backend
> work is split into a separate feature. If any proto **enum** is ever touched as part of that split,
> note ledger `fails.md` 2026-07-21 (fix-custom-formula-allnone / C-10(a/d)): the `xstockstrat-ui`
> `BacktestDiagnostics.tsx` maps `NoTradeReason` / `BarAction` with an **exhaustive** `Record<Enum,…>`,
> so a new enum value hard-couples to a UI map edit in the same PR or `pnpm build` fails.

## Config Key Changes

- [ ] No new config keys **required**, but FR-19 proposes three app-level chrome props
  (`density`, `showCopilot`, `accountMode`). If these are served via `xstockstrat-config` rather than
  build-time/env defaults, they must follow `<service>.<category>.<key>` naming
  (e.g. `ui.chrome.density`, `ui.chrome.show_copilot`, `ui.chrome.account_mode`), be documented in the
  service `CLAUDE.md`, and be added to the Per-Feature Registered Keys log. **Decision deferred to
  `/sdd-design`** — the handoff calls them "app-level config," which could be satisfied by env
  defaults without touching the config service.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/ui-revamp-opportunities-first` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — `xstockstrat-ui` owner (UI-only change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A unless design splits out backend work
- [ ] DBA review + service owner (schema migration) — N/A

Given the size (12 screens + shell + Copilot + mobile + editors), this feature is a strong candidate
to be **decomposed into multiple `/sdd-spec` + `/sdd-execute` slices** (e.g. shell/nav first, then one
tab group at a time) rather than one monolithic PR. `/sdd-design` should recommend the slicing.

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
   footer states "xstockstrat never writes to the ledger," and balances reflect the 10s poll.
9. Loading, empty, and error states are implemented for every data screen (skeletons, empty copy,
   per-card error notices).
10. The mobile companion renders 1:1 with every desktop screen via the shared section renderer, with a
    bottom tab bar and all tap targets ≥ 44px.
11. CI green: `pnpm lint`, `tsc`/`pnpm build`, vitest logic tests (`src/lib/**`), and the Playwright
    e2e suite (including the new nav-reachability + per-screen tests); coverage ≥ the `xstockstrat-ui`
    threshold.

## Open Questions

- [ ] **Scope split.** Should the whole revamp land as one feature, or should the backend-data gaps
  (Copilot thread persistence, watchlist "readiness" scoring, per-signal thesis text, "queue would
  use $X" deployable math, factor-exposure "after" math) each become their own feature? Several
  screens show data the current RPCs may not return. `/sdd-design` must map each screen's fields to a
  real data source and flag every gap. **(Known trap — ledger `fails.md` 2026-07-01 060 / 2026-07-30
  080: an "already served" assumption must be grep-verified against the producer, not assumed.)**
- [ ] **Config vs env for chrome props** (FR-19 / Config Key Changes) — config-service keys or
  build-time defaults?
- [ ] **Existing routes / URL compatibility.** Do the current `/trader`, `/insights`, `/config-ui`
  path prefixes stay (with the new shell layered over them), or does the revamp introduce new routes?
  Bookmarks, the DO App Platform route rules (`/agent` → agent, `/` → ui), and the auth middleware
  matcher all key off the current paths — the design must decide whether to preserve or migrate them.
- [ ] **Copilot data source.** Is the "Read of the queue" / concentration-flag content computed
  client-side from the queue, or does it require a backend/agent call? Determines whether the rail is
  pure presentation or needs a new surface (→ possible separate feature).
- [ ] **"Nocturne" tokens vs existing theme.** The current `xstockstrat-ui` is already **dark-only**
  (the `:root` tokens in `src/app/globals.css` are dark — `--background: 222 47% 4%`; there is no
  light theme, no `.dark` variant, and no theme toggle) and `tailwind.config.js` already defines
  custom `buy` / `sell` / `paper` colors — so Nocturne's gain / loss / paper roles have existing homes
  to map onto rather than a from-scratch token layer. `/sdd-design` recon should diff the Nocturne
  values (`#161826` bg, `#9184d9` accent, `#4cc79c` / `#e0787a` / `#c9b47e`) against these existing
  `globals.css` `:root` vars + `tailwind.config.js` and decide reconcile-vs-restyle. Note: tokens live
  **inline** (no separate design-token module), so a token change touches those two files.
- [ ] **The existing `accounts` segment.** The current app has a **fourth** segment beyond the
  handoff's Decide/Discover/Engine/Book model — `accounts/` (`authorized-apps`, `mcp-tools`, plus
  OAuth login), reachable from `PLATFORM_NAV`/`PLATFORM_SUBNAV`. The handoff does not place these
  screens. `/sdd-design` must decide where authorized-apps / mcp-tools / account management live in the
  new four-tab shell (a fifth section? folded under Book or a settings surface?) so they don't become
  unreachable — the exact C-10(a) failure mode from the ledger.
- [ ] **Signal sources & watchlist backing.** The handoff derives Signal sources from "config-ui
  concepts" and Watchlists from "screener + watchlist concepts." Discovery confirms
  `useInsightsSignalSources.ts` and `useWatchlists.ts` (full CRUD) already exist — `/sdd-design` should
  confirm these hooks return the fields the new screens show (readiness state, blocking condition,
  health checks) versus needing new ones.
