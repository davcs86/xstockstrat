# Handoff: xstockstrat UI — opportunities-first trading app

## Overview
xstockstrat is a trading application reframed around an **opportunity queue** rather than portfolio monitoring. The core idea: the broker (Alpaca / IBKR) owns the ledger and P&L; xstockstrat's job is to surface *ranked, actionable signals* (buy / trim / exit) from the user's strategies, watchlists and screener, explain why each fired, and let the user act with one confirmation. An MCP-backed "Copilot" reads the queue and answers questions.

The app is one shell (left nav + top breadcrumb bar + optional Copilot rail) with screens grouped under four tabs: **Decide / Discover / Engine / Book**. A "Mobile companion" view shows a phone rendering of every screen.

## About the Design Files
The file in this bundle — `xstockstrat UI.dc.html` — is a **design reference created in HTML**. It is an interactive prototype showing the intended look, layout and behavior. **It is not production code to copy directly.**

The task is to **recreate these designs in the target codebase's existing environment** and patterns. The real app is a **Next.js (App Router) + React + TypeScript** codebase using Tailwind, TanStack Query, Connect-RPC clients, and a `components/ui/*` primitive set (Button, Card, Badge, Input, Select, Table, etc.). Recreate each screen with those primitives and the repo's data hooks — do **not** ship the HTML. `source-map.md` lists which repo modules each screen was derived from.

> Note on how the prototype is built: it's a single "Design Component" HTML file using a small template runtime (`<sc-if>`, `<sc-for>`, `{{ }}` holes) with all logic in one `class Component` at the bottom `<script>`. Treat the template + the data arrays in that class as the spec. Ignore the runtime mechanics.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, iconography and interaction states are intended to be reproduced faithfully. All visual values come from the **Nocturne** design system (a dark, low-chroma theme with a single blurple accent). In the real repo, map these to the equivalent Tailwind tokens / CSS variables already in the codebase rather than hard-coding hexes where a token exists. Where a value below is given as a hex, it is the Nocturne token's resolved value for reference.

---

## Design Tokens

The prototype links the Nocturne stylesheet and reads everything from CSS variables. Key resolved values:

### Color roles
| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#161826` | Page ground (near-neutral blue-grey) |
| `--color-text` | `#e9e9ed` | Primary text |
| `--color-accent` | `#9184d9` | Single accent (blurple) — lines, marks, active states |
| `--color-accent-100/200/300` | lighter accent steps | Accent text on dark tints (300 for paragraph-size) |
| `--color-accent-800` | deep accent | Subtle accent borders |
| `--color-surface` | slightly raised ground | Chips, selects |
| `--color-divider` | low-contrast rule | All 1px borders / row rules |
| `--color-neutral-300…800` | tonal ramp | 300 muted-light text → 800 subtle fills/borders |

### Semantic colors (defined locally in the prototype `:root`)
| Token | Value | Meaning |
|---|---|---|
| `--gain` | `#4cc79c` | Up / buy / pass / positive |
| `--loss` | `#e0787a` | Down / sell / fail / negative / destructive |
| `--paper` | `#c9b47e` | Warning / "soft" condition / paper-mode / partial |
| `--mono` | `ui-monospace, "SF Mono", Menlo, monospace` | All numeric + code/ID text |

Tinted fills use `color-mix(in srgb, <color> 15%, transparent)` with the solid color as text — this is the standard "badge" recipe throughout (e.g. a gain badge = 15% gain fill + gain text).

### Typography
- **Heading font**: `var(--font-heading)` (Inter), used for screen titles (`<h4>` ~19px) and card titles (13–14px). Never bolder than weight 500 — hierarchy is size + space, not weight.
- **Body font**: `var(--font-body)` (Inter), base 14px (13px in compact density).
- **Mono**: all numbers, tickers, IDs, thresholds, timestamps, kicker labels.
- **Kicker label** pattern (section eyebrows, stat labels): `font: 600 9px/1 mono; letter-spacing: .13em; text-transform: uppercase; color: neutral-600`.
- `font-variant-numeric: tabular-nums` on every column of numbers.

### Spacing / radius / density
- Compact density is the default (Nocturne is 0.70× dense). Spacing uses `var(--space-*)`; radii `var(--radius-md)` (~8px) for cards/inputs, `var(--radius-lg)` for the mobile confirm sheet.
- Screen headers: `padding: 15px 18px 13px`, bottom `1px solid divider`.
- Stat rows: 4–5 equal columns, each `padding: 12px 18px`, right `1px solid divider`.
- Tables: `.table` class (themed header + row rules), `font-size: 12.5px`.

### Interaction states (themed, never browser defaults)
- Hover on nav/rows: `background: color-mix(in srgb, var(--color-text) 6%, transparent)`.
- Active nav item: `color-mix(in srgb, var(--color-accent) 12%, transparent)` fill + a 3px accent bar on the left + text goes to `--color-text`.
- Focus: `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`.
- Buttons are **outlined**, not solid-filled: `.btn-primary` is a 1px accent border on transparent; `.btn-secondary` neutral outline; `.btn-ghost` text-only. Destructive button = 1px `--loss` border + 8% loss tint.
- Disabled: 45% opacity.

### Icons
Phosphor icons (https://phosphoricons.com) at interface sizes. The few inline SVGs in the prototype (sparkline, sparkle/Copilot glyph, chevrons, warning triangle) are hand-drawn stand-ins — replace with Phosphor equivalents.

---

## App Shell (persistent chrome)

**Layout**: CSS grid `212px 1fr`, min-height 100vh.

- **Left sidebar** (`212px`, sticky, full height, `1px` right divider):
  - Brand lockup: 22px rounded-square accent-outlined mark + a mini line-chart glyph + "xstockstrat" (heading, 13.5px).
  - Four labelled nav sections, each a kicker label + its items. Item = 3px left mark (accent when active) + label (12.5px) + optional right-aligned count badge (mono 10px, accent for the Opportunities "7").
    - **Decide**: Opportunities (badge 7), Signal detail
    - **Discover**: Watchlists (badge 4), Screener
    - **Engine**: Strategies (badge 6), Backtest, Signal sources, Backfills
    - **Book**: Exposure (badge 6), Portfolio, Orders (badge 3)
  - Footer: "Mobile companion →" ghost button; a small "Signal engine live" status card (green dot + "last eval 14:32:08 · 240ms").
- **Main column**:
  - **Top bar** (49px, sticky, bottom divider): breadcrumb `Module / Page` (module in neutral, page in text); a vertical divider; an account switcher button (`A1F2` mono chip + "Alpaca · Primary" + chevron); a **PAPER** tag (paper-tint); pushed right, a **Copilot** toggle button (accent outline + fill when active).
  - **Content region**: `display:flex` with the active screen (`flex:1`) and, when Copilot is open, a `310px` right rail.

**Copilot rail** (`310px`, left divider, sticky): header (sparkle glyph + "Copilot" + close X); scrollable body with a "Read of the queue" paragraph, a "Concentration flag" accent-bordered card with two actions, a divider, an "Asked earlier" thread (role label + message), then a sticky footer with an input, suggestion chips, and an "MCP · 14 tools · read-only unless you confirm" note.

**Tweakable props** (surface as app-level config, not per-user chrome): `density` (`compact` | `comfortable`), `showCopilot` (boolean, default off), `accountMode` (`paper` | `live`).

---

## Screens / Views

All screens follow the same header grammar: kicker (module name, accent) + `<h4>` title + one-line description; optional right-aligned action(s). Then usually a stat row, then the main table/content. Rows that open a detail are `cursor:pointer` and navigate to Signal detail.

### 1. Opportunities (Decide) — the home queue
- **Purpose**: the ranked list of actionable signals; the primary surface.
- **Stat row (5)**: Actionable now (7, accent) · Expiring <90m (4, paper) · Exit/trim flags (2, loss) · Fresh entries (3, gain) · Deployable ($312k).
- **Source filter chips**: All sources / Portfolio / Watchlists / Screener (first checked).
- **Queue table**: each row = ticker, an **action tag** (ENTER/ADD = gain, TRIM = paper, EXIT/SELL = loss — via `actionTint`), conviction % (colored: ≥80 gain, ≥70 accent, else neutral), a thesis line, a 40-point sparkline (colored by up/down), change %, expiry (paper when `warn`). Click → Signal detail.

### 2. Signal detail (Decide)
- **Purpose**: why one signal fired + the order ticket.
- Left: symbol header, a candlestick chart (timeframe tabs 5m/1H/1D/1W/1M, SMA overlay, target/stop dashed guides), and a **conditions** list — each condition: name, live value, threshold, a strength bar, pass (gain) / soft (paper) state.
- Right: a **buy/sell** segmented toggle (gain/loss tinted), the order ticket rows (Notional, Risk at stop, Position after, Semis exposure after), and a strategy track-record block (Signals taken, Hit rate, Avg win/loss, Expectancy).

### 3. Watchlists (Discover)
- Left list of watchlists (name + "N ready", accent when >0; first active). Right: a table of that list's symbols — ticker, last, change %, a "readiness" bar + state (firing / N away / watching / quiet), what's blocking, the strategy, and an action ("In queue →" / "Alert me").

### 4. Screener (Discover)
- Left rail: **Universe** select, a weighted **Criteria** list (metric, op, threshold, a weight bar, hard/rank tag), "+ Add criterion", and a Copilot suggestion card. Right: ranked results table (rank, symbol, score + colored %, PE, RSI, rev growth, ATR, whether held). Header actions: "Save as watchlist", "Run scan".

### 5. Strategies (Engine)
- **Purpose**: the strategies that generate signals.
- Stat row (5): Active strategies (5, "1 paused") · Signals 30d (140) · Blended hit rate (62.1%) · Portfolio expectancy (+1.3%) · Queue share (71%).
- Table: strategy id (mono), **State** tag (ACTIVE = gain, PAUSED = paper), Signals 30d, Taken, Hit rate (≥60 gain), Expectancy (gain/loss), Max DD (loss), a 90-day equity sparkline, "Open →". Click → Strategy editor.
- Below: a featured strategy card with a large equity-vs-SPY chart + a diagnostics side panel + a Copilot read.
- **State vocabulary is Active / Paused / Off** (NOT Live/Paper — that would collide with the account trading mode). Strategies have **no** "Universe" field (universe belongs to the screener + signal sources, not strategies).

### 6. Backtest (Engine) — *new*
- **Purpose**: run a strategy over history and read, bar by bar, why it did/didn't trade. Derived from `EquityCurveChart.tsx`, `BacktestDiagnostics.tsx`, `useBacktest.ts`, `fixtures/backtests.ts`.
- **Config bar** (5 fields, `align:end`): Strategy select · Symbols input (`AAPL, NVDA, MU`) · Start date · End date · Timeframe select (1 day / 1 hour / 15 min). Header actions: "Run history", "Run backtest".
- **Coverage-gap notice** (loss-outlined, 40% loss border): warning triangle + "Insufficient history for AAPL — have 3 bars, need 52." + sub explaining the 75-day pre-window warm-up span (`2024-08-12 → 2024-10-26`) has no bars + a **"Backfill this range →"** secondary button that navigates to Backfills. (Mirrors `BACKTEST_STATUS_INSUFFICIENT_DATA` where the gap is the pre-window span, distinct from the requested range.)
- **Equity + diagnostics row** (`1fr 300px`):
  - Equity curve card: title "Equity curve — % return per symbol" (normalized % for multi-symbol runs, per the real component), an SVG line (accent) + benchmark dashed line + entry (gain) / exit (loss) marker dots; legend "● entry / ● exit / — — SPY buy & hold".
  - Diagnostics panel: CAGR (+21.4%, gain) · Sharpe (1.38) · Max drawdown (−8.2%, loss) · Avg hold (6.4 days) · Slippage assumed (4 bps) · Trades/month (~14).
- **Day-by-day debug table**: header "Debug — day by day · NVDA · 52 bars · 40 warm-up". Columns: Date, Close, Volume, sma_20, rsi_14, vol/adv, Warm (✓), **Action**, Conv. Action maps `BarAction`: Warm-up (neutral, whole row dim), Flat/Hold (neutral text), **Buy** (gain, row 8% gain tint), **Sell** (loss, row 8% loss tint). Conviction colored ≥0.7 gain / ≥0.5 accent / else neutral. Warm-up rows render "—" for indicators.

### 7. Signal sources (Engine)
- Stat row (5): Sources live (5/6) · Needs attention (1, loss) · Symbols covered (512) · Median latency (240ms) · Strategies fed (6/6). Left: sources table (id, kind, symbols, a freshness sparkline, a health bar, feeds count, live/stale status tag — selecting a row highlights it). Right: a detail panel for the selected source (status, freshness, checks with ok/warn/fail colors, recent log lines, a note, and which strategies read it). Header: "Add source".

### 8. Backfills (Engine, admin) — *new*
- **Purpose**: create / monitor / cancel / delete historical OHLCV backfills. Derived from `app/insights/backfills/page.tsx`, `useBackfills.ts`. **Admin-only** (an "ADMIN ONLY" accent tag sits in the header; in the real app the create + delete panels are gated by `useIsAdmin()`).
- **Stat row (5)**: Jobs running (2, accent) · Completed today (18, gain) · Symbols covered (512) · Bars stored (48.2M) · Needs attention (2, loss).
- **New backfill** card: Symbols input · Timeframe select · Start · End · "Start backfill" primary; below, an "Overwrite existing bars in range" checkbox.
- **Filters**: status select (All / Queued / Running / Completed / Partial / Failed / Canceled) + symbol filter input + "polling every 4s" note (the real hook polls on a 4s interval while non-terminal).
- **Job list**: each job card = a **status tag** + symbols (mono) + timeframe; a progress bar + "bars X / Y · chunks A / B"; an error line (loss) when present; the job id (mono, dim). A **Cancel** button shows only for `running`/`queued`. Status → color: completed = gain, running = accent, partial = paper, failed = loss, queued/canceled = neutral. Example rows: AAPL running (bars 100/500, chunks 1/5, job-1); MU,SMCI queued; NVDA,AVGO,TSM completed; PANW,CRWD,NOW partial (with vendor-empty-chunks error); INTC failed (429 rate-limit); COST canceled.
- **Delete panel** (destructive, loss-outlined): Symbol · Timeframe (defaults "All timeframes") · Start · End · a "Type the symbol to confirm" input · a "Whole-symbol delete — type \"DELETE ALL\"" input · a destructive "Delete data" button. (In the real app the button is disabled until the typed symbol matches, and an empty range → whole-symbol delete requires the second `DELETE ALL` confirm.)

### 9. Exposure (Book)
- **Purpose**: what each position is *risking* and what would trigger an exit — framed as risk, not P&L ("your broker has the P&L").
- Stat row (4): Total risk at stops ($4,180) · Largest factor (Semis 22%, paper) · Positions past target (1, gain) · Stops within 2% (2, loss).
- Table: symbol, qty, weight, Open R (gain/loss), Risk at stop (loss), a stop-distance bar + %, exit rule, factor, and a flag ("Add signal" / "Trim signal" / "Exit signal" / "Stop near"). Header: "2 exit flags in queue →" (to Opportunities).

### 10. Portfolio (Book) — *new*
- **Purpose**: a **read-only mirror** of what the brokers report — Alpaca and IBKR own the ledger and P&L. Derived from `PortfolioPanel.tsx`, `usePortfolio.ts`, `fixtures/portfolios.ts` (balances refresh every 10s from the broker; the app never writes to the ledger — state this in the UI).
- **Stat row (5)**: Combined equity ($80,000) · Cash ($30,000) · Buying power ($40,000) · Day P&L (+$100, gain) · Total P&L (+$2,300, gain).
- **Account cards (2, `1fr 1fr`)**: each = account code chip + name + broker tag, then a 2-col grid of Equity / Cash / Buying power / Day P&L (gain/loss) / Total P&L / Positions, then a note.
  - **Alpaca · Primary (A1F2)**: Equity $50,000 · Cash $20,000 · Buying power $40,000 · Day P&L +$150 (+0.30%) · Total P&L +$1,500 · 4 open.
  - **IBKR · Long-term (I9K3)**: Equity $30,000 · Cash $10,000 · Buying power — · Day P&L −$50 (−0.17%) · Total P&L +$800 · flat today.
- **Positions table** (Alpaca): Symbol, Account, Qty, Avg cost, Mkt value, Unrealized (gain/loss), Day P&L (gain/loss). Rows: NVDA 60 @113.80 $7,608 +$820 +$90 · AAPL 40 @215.65 $8,730 +$100 +$40 · AVGO 20 @159.40 $3,369 +$180 +$30 · MSFT 15 @400.10 $6,240 +$400 −$10. (Unrealized sums to +$1,500 = Alpaca total; day sums to +$150 = Alpaca day.) Footer note: "Balances refresh every 10s from the broker · xstockstrat never writes to the ledger."

### 11. Orders (Book)
- Table of today's orders: symbol, side (BUY gain / SELL loss), type, qty, filled, avg, **status** tag (filled = gain, working = accent, rejected/canceled = loss), origin (strategy or Manual), time, and an action (View / Edit / Why?). Click → Order editor.

### CRUD editors (reached from New/Edit on the list screens)
- **Strategy editor**: Definition (Name — full width, no Universe field), "What it looks for", Horizon segmented (Intraday/Swing/Position), **State segmented (Active/Paused/Off)**; entry/exit condition builders (add/remove rows with metric/op/threshold/weight); a backtest preview.
- **Source editor**: endpoint, API key, universe, field mapping.
- **Order editor**: side, type, qty, limit/stop, an order preview.
- **Watchlist editor**: name + an add-by-symbol input (Enter or "+" appends; each row removable).
These are functional in the prototype (add/remove works); in the real app back them with the corresponding mutation hooks.

### Mobile companion (1:1 parity) — *rebuilt*
- **Purpose**: the same app on a phone. **One iOS frame per desktop screen (11 total)**, shown in a horizontal rail; each carries a caption of which desktop screen it mirrors.
- Every phone uses **one shared renderer**: a top title + a small tag (PAPER / ADMIN / a count), a sub line, an ordered list of **sections**, and a fixed **bottom tab bar** (Decide / Discover / Engine / Book) with the active tab marked in accent. Section kinds:
  - `stat` — 2-col grid of label/value/sub stat cards.
  - `signal` — the rich queue card (ticker, action tag, conviction, thesis, meta, Snooze + CTA buttons; buttons ≥36px, the primary action bar ≥46px).
  - `chart` — a compact candlestick block with target/stop dashed guides.
  - `row` — a two-line list row (left title + sub, right value + sub) — the workhorse for tables on mobile.
  - `form` — labelled read-only field rows.
  - `note` — an outlined callout (accent / paper / loss border).
  - `action` — a button row.
  - `head` — a kicker section label.
- **All tap targets ≥44px.** The rail replaces the earlier "queue + confirm only" companion — the design intent is now full parity, so implement mobile as the same routes/screens in a responsive or native shell, not a reduced subset.

---

## Interactions & Behavior
- **Navigation**: left-nav items and in-screen "→" affordances switch the active screen; list rows open detail/editor screens; "Backfill this range →" (Backtest) jumps to Backfills; "See risk in Exposure →" (Portfolio) jumps to Exposure; "Mobile companion →" opens the mobile rail; breadcrumb reflects the active screen.
- **Copilot toggle**: header button opens/closes the 310px right rail; button shows an active (accent-filled) state when open.
- **Segmented controls**: buy/sell, horizon, strategy state — the selected option gets an accent (or gain/loss) tint.
- **Editors**: watchlist add-symbol (Enter or "+") and strategy condition add/remove mutate a local list live; wire to real mutations in the app.
- **Live/polling data** (from the real hooks — reflect in loading/stale UI): portfolio & positions every 10s; backfill jobs every 4s while non-terminal (stop polling on terminal states: completed/failed/partial/canceled); order updates streamed.
- **States to implement** the prototype only hints at: loading (skeleton per card/table), empty ("No backfill jobs match the filter", "No portfolio data", "No equity curve data for this run"), error (per-card notice), and destructive-confirm gating on the backfill delete.
- **Animations**: keep subtle — themed hover tints, the accent focus ring, tag/segment transitions. No heavy motion.

## State Management
Reproduce with the codebase's existing patterns (TanStack Query + Connect clients in the real repo). Conceptually:
- **UI/local**: active screen/route, Copilot open, density, account selection, buy/sell + timeframe toggles, editor draft state (watchlist symbols, strategy entry/exit conditions), backfill create-form + filter + delete-form fields and their typed-confirmation gates.
- **Server/query**: opportunities queue, signal detail, watchlists, screener results, strategies + definitions, backtest run (diagnostics + trades + coverage gaps), signal sources health, backfill jobs (polled) + single job status, exposure/positions, portfolios (polled), orders (+ streamed updates), admin flag (`useIsAdmin`).
- Key data shapes to honor (from `source-map.md` / protos): `Portfolio` (equity/cash/buyingPower/dayPnl/dayPnlPct/totalPnl/positions), `BackfillJob` (status enum, barsProcessed/barsTotal, chunksCompleted/chunksTotal, failedSymbols, error), `BacktestResult` + `CoverageGap` (barsHave/barsNeed, requestedRange vs pre-window gap), `SymbolDiagnostics`/`bar` (indicators map, warmup, `BarAction`, conviction).

## Assets
No raster assets. All imagery is inline SVG: sparklines and candlesticks (generated from seeded pseudo-random series — replace with real chart components, e.g. the repo's Recharts `EquityCurveChart`), the brand mark, the Copilot sparkle, chevrons, and a warning triangle. Icons should be **Phosphor**. Fonts: **Inter** (heading + body) and a monospace stack for numerics.

## Files
- `xstockstrat UI.dc.html` — the full interactive prototype (all 11 screens + editors + mobile). Open in a browser to interact; read the bottom `<script>` `class Component` for the exact data behind every screen (the `*Stats`, `strategies`, `exposures`, `btBars`, `backfillJobs`, `portfolioAccounts`, `phones`, etc. arrays) and `renderVals()` for the color logic.
- `source-map.md` — maps each screen to the real repo modules it was derived from (repo `davcs86/xstockstrat`, `services/xstockstrat-ui`).
- `screenshots/` — a reference capture of every screen (01–11 desktop, 12 mobile companion), numbered to match the Screens list above.
