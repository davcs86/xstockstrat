# Product Spec: position-and-order-detail-pages

**Feature**: `docs/roadmap/features/096-position-and-order-detail-pages/`
**Status**: `spec-ready`
**Created**: 2026-08-02

---

## Problem

The Nocturne design handoff (`docs/roadmap/features/083-ui-revamp-opportunities-first/design-handoff/xstockstrat UI.dc.html`)
specifies two dedicated **detail pages** that feature 083 did not ship as pages:

1. **POSITION DETAIL** (`isPosition` block) — a full-page view of a single held position, opened by
   clicking a row on **Book → Exposure** (or Portfolio): a risk-framed header, a stat grid, a
   price chart drawn from entry to stop, a per-symbol **Orders & fills** table, and a right
   sidebar (risk & exit / manage / why-it's-held / broker).
2. **ORDER EDITOR / ticket** (`isOrderEdit` block) — a single-order ticket: header (symbol / side /
   status), a field grid (type / TIF / qty / limit / stop / origin), and an order-preview sidebar.

Feature 083's follow-up (#853) raised the single-Position fidelity only as a **row-click Sheet**
(a drawer over the Exposure table), and the single Order is still a **read-only card**
(`/trader/orders/[id]`). Neither is the dedicated, richly-laid-out page the handoff shows, and the
Sheet cannot be linked, bookmarked, or opened from the Portfolio surface.

## Goal

Ship the two dedicated pages at the handoff's fidelity — data-rich on desktop and usable on mobile —
using **only data the platform already returns**. Where the prototype shows a value with no backend
source (a prose "why it's held" thesis, a price target, reward:risk, realized-P&L, a live
sparkline), omit it rather than fabricate it; those belong to feature 095
(`opportunity-live-market-enrichment`), which is already tracking the un-faked Decide-surface extras.

## Consumer Surface(s)

- **UI — `/trader`** (the Book group). Two routes:
  - `/trader/positions/[symbol]` — **new** dedicated Position page.
  - `/trader/orders/[id]` — **existing** route, upgraded in place to the ticket grammar.
- No Agent (MCP) surface. No backend service behavior change (read paths + one additive BFF method
  over an already-existing gRPC RPC).

## Users & Value

The solo trader who runs this platform. From the risk-first Exposure list they open one position and
see, on one page: what it is risking, what would trigger an exit, the price relative to avg-cost and
stop, and every order/fill that built it — then act (add / trim / move stop / close) via the order
ticket. From the Orders list they open one order and can amend or cancel it while it is working.

## Functional Requirements

- **FR-1** A new route `/trader/positions/[symbol]` renders a single position for the selected
  account + environment mode, read from the authoritative portfolio source.
- **FR-2** The Position page header shows: symbol, Long/Short + qty, current price, today's change
  ($ and %), weight of equity, and two large figures — **Unrealized** (P&L) and **Open R** — all
  from the enriched `Position`.
- **FR-3** A stat grid shows Avg cost, Last, Cost basis, Market value, Unrealized, Day P&L
  (mono + `tabular-nums`, semantic gain/loss tint).
- **FR-4** A candlestick chart (marketdata bars) draws the recent price history with **avg-cost**
  and **stop** reference overlays; the stop overlay is omitted when the position carries no resting
  stop. Timeframe is switchable (15m / 1h / 1d — the platform-supported set).
- **FR-5** A per-symbol **Orders & fills** table lists this symbol's orders (side / type / qty /
  filled / avg fill / status / origin strategy / when), each linking to its order ticket.
- **FR-6** A risk sidebar shows the stop-distance meter and rows for Risk at stop, Exit rule, Factor
  bucket, Day P&L, plus **Manage** actions (Add / Trim / Move stop / Close → the order ticket) and a
  broker block naming the owning account (read-only; the broker owns the ledger — C-10(b)).
- **FR-7** When the symbol has orders carrying a strategy id, the sidebar names the owning strategy
  and links to its strategy page; when none, it degrades gracefully (no fabricated strategy).
- **FR-8** Exposure and Portfolio rows link to `/trader/positions/[symbol]` (Exposure keeps its
  existing quick-Trade shortcut). C-10(a): the page is reachable by walking Book → Exposure → row.
- **FR-9** The `/trader/orders/[id]` page is re-laid-out to the ticket grammar: header (symbol / side
  badge / status badge / order id), a field grid (type / TIF / qty / filled / limit / stop / avg
  fill / account / strategy / broker order id / mode), and an **order-preview** sidebar (notional,
  filled %, remaining qty, origin strategy) derived from the order's own fields.
- **FR-10** For a **working** order (NEW / PARTIALLY_FILLED) the ticket page offers **Edit** (→
  `ReplaceOrder` via the existing `EditOrderDialog`/`useReplaceOrder`) and **Cancel** (→
  `CancelOrder` via `useCancelOrder`); for a terminal order these actions are hidden. Execution
  semantics are unchanged (FR-20 parity with the existing order flows).
- **FR-11** Both pages are responsive: the two-column desktop layout collapses to a single column on
  mobile, tables reflow without a horizontal scroll trap, and every interactive control is ≥44px
  (FR-16 tap-target floor).
- **FR-12** Non-happy states use the shared primitives: `Skeleton` while loading, `EmptyState` for
  "position not found / no orders", `CardNotice`/inline `text-destructive` for errors.

## Non-Goals

- **No** new *creation* flow — "New order" continues to live on the trader dashboard `OrderForm`.
- **No** live price sparkline, per-condition live value chips, price target, reward:risk, suggested
  sizing, or realized-P&L — these have no current backend source and are **feature 095**'s scope.
- **No** proto, migration, or config change. No new inter-service edge.
- **No** Copilot surface on these pages (explicitly out of scope per the task).

## Acceptance Criteria

- **AC-1** Navigating Book → Exposure → clicking a position row lands on `/trader/positions/<SYM>`
  showing that symbol's header, stat grid, chart, orders table, and risk sidebar.
- **AC-2** A position with a resting stop renders the stop overlay + Risk-at-stop + stop-distance
  meter; a position without one renders em-dash fallbacks and no stop overlay (no crash, no fake 0).
- **AC-3** The AAPL unrealized-P&L shown on the Position page equals the value the Exposure list and
  Portfolio show for AAPL (C-10(b) valuation parity — one authoritative source).
- **AC-4** `/trader/orders/[id]` for a working order shows Edit + Cancel; Edit opens the Replace
  dialog and Cancel calls `CancelOrder`; a filled order shows neither.
- **AC-5** Both pages render without horizontal-body scroll at 375px width and keep ≥44px tap
  targets (mobile-overflow spec passes).
- **AC-6** `pnpm lint`, `tsc --noEmit`, `pnpm test:unit`, and the new/updated Playwright specs pass;
  `jscpd` reports no new duplication (shared helpers extracted).

## Governance / Constitution notes

- **C-10(a)** — new route reachable by walking the shell; reachability e2e asserts the Exposure-row
  → Position-page click-through. `/trader/positions/[symbol]` resolves to Book → Exposure via the
  existing `startsWith` nav match (no `PLATFORM_SUBNAV` addition — it is a detail route, like
  `/trader/orders/[id]`).
- **C-10(b)** — unrealized-P&L parity across Exposure list, Portfolio, Position page (all read the
  broker-authoritative `Position`).
- **C-12 / C-13** — new/updated e2e specs and mock-backend handlers use `e2e/fixtures/*`; a new
  domain fixture gets an `INVENTORY.md` row.
- **F-07** — no hardcoded config; nothing config-driven added.
- **P-03** — no fabricated data: values without a source are omitted, deferred to feature 095.
