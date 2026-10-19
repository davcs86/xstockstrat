# Context: offline-account-full-pnl

**Feature**: `docs/roadmap/features/230-offline-account-full-pnl/feature.md`
**Product Spec**: `docs/roadmap/features/230-offline-account-full-pnl/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/230-offline-account-full-pnl/implementation-spec.md`

---

## Session 2026-10-19 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Scope fixed by operator Q&A (2026-10-19), before any spec was written:
  - Components: Day P&L, Total P&L + return %, fees/commissions. Offline P&L in the `GetPnL`/insights
    aggregate was offered and **not selected** → out of scope.
  - Fee model: **separate line**; realized shown gross and net; fees never enter cost basis.
  - Day P&L: **broker-style** (overnight shares vs previous close, same-session shares vs fill price,
    plus same-session realized).
  - Return % denominator: **open cost basis** (no capital-base ledger).
  - Mark fallback: **latest daily-bar close, flagged stale**.
  - Surfaces: PortfolioPanel (single + combined), Book offline card, positions list + detail, MCP agent tools.
  - Backfill: fees default 0; lifetime realized seeded from the current since-snapshot value; no reconstruction.
- **Operator override of feature 163 (explicit sign-off, 2026-10-19):** operator chose "Both" for
  realized scope, i.e. keep 163's since-snapshot reset (163 AC-14 preserved) **and** add a lifetime
  realized carried across snapshots. This overrides 163's rejected alternative "carry realized forward
  across snapshots". Fees on snapshot baselines are not part of the override.
- Baseline grounding (recon by Explore agent): offline Day P&L hard-coded 0 at
  `services/xstockstrat-trading/internal/service/trading.go` (`recomputeAndEmitOfflinePositions`);
  `ConfirmOrderRequest` has no fees field (`packages/proto/trading/v1/trading.proto:158-164`);
  `Portfolio.realized_pnl` is offline-only `optional` field 12 (`packages/proto/portfolio/v1/portfolio.proto:59-62`);
  realized stored in `portfolio.offline_account_realized` (portfolio migration 012); short
  `unrealized_pnl_pct` is 0 because it is only set when `CostBasis > 0`.

## Session 2026-10-19 — sdd-review product-spec (round 1: FAIL → spec revised)

- Round-1 verdict: FAIL (criteria #2, #7, #8, #9, #10; no Floor breach); overlap: warnings only.
- Operator decisions taken to resolve the blockers (2026-10-19, explicit):
  - **C-16 business-rule change (signed off):** a quote batch that fails or exceeds its deadline now
    triggers the last-close fallback for **offline** positions. This changes durable rule
    `services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature` @AC-1 (feature 229,
    "current_price 0 on timeout") for offline positions; its deadline bound is kept. Update that suite at
    launch promotion (feature AC-27 supersedes it for offline positions).
  - **Short-% fix is platform-wide** (shared portfolio enrichment uses `|cost_basis|`); this is the one
    deliberate broker-visible change, carved out of FR-8 (AC-26).
  - **Off-session Day P&L** shows the most recently completed session until the next open (AC-24).
  - **Intraday consumption order:** reductions consume overnight shares first (FR-1, AC-23).
- Defaults applied by orchestrator, following prior operator scope (aggregates out of scope):
  `GetPnL` unchanged, feature 229 @AC-5 preserved for offline holdings (AC-28); combined PortfolioPanel
  sums each account's own figures, realized/fee rows labelled offline-only (AC-30).
- Spec edits: Definitions section (session, signed qty, overnight shares); FR-1 signed formula +
  `day_pnl_pct` base; FR-2 `Σ|cost_basis_i|`; FR-3 cumulative fees on partial confirms, no `fees_accum`
  routing; FR-5 unpriced excluded from Equity; new FR-9 read-path parity; DB migrations named
  (trading 011, portfolio 017, up+down, independent); `MarkSource` values prefixed; ledger payload moved
  out of Proto; `QueryBars` corrected to `BatchGetLatestPrice`/`BatchGetBars`; OQs ticked (resolved or
  deferred to /sdd-design).
- Acceptance: AC-1..19 content fixed in place (IDs unchanged); AC-20..31 added (sell fees, partial-fill
  fees, short cover, overnight-first round trip, weekend read, mixed-book denominator, broker short %,
  timeout fallback, GetPnL unchanged, read-path parity, combined panel, position detail page).
- Ordering (overlap scan): feature 229 is merged (branch now includes it); land after 215
  (`block-fundamentals-strategy-on-etf`, touches `app/tools.py`, `mcp-tools.md`,
  `positions/[symbol]/page.tsx`) and rebase. No hard merge-order row needed. Offline fees must not reach
  broker `fees_accum` (feature 029 path) — encoded in FR-3.
