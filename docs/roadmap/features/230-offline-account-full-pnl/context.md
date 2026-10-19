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

## Session 2026-10-19 — sdd-review product-spec (round 2: FAIL → spec revised)

- Round-2 verdict: FAIL on one blocker. FR-9/AC-29 named `StreamPortfolioUpdates`, which streams
  user-level `PortfolioSnapshot` (`portfolio.proto:17,140-149`) built from the `portfolio.snapshots`
  series that FR-8 freezes. Fixed with the reviewer's option (a): the stream was removed from FR-9/AC-29
  and moved to Out of Scope. All 31 scenarios' arithmetic had been verified.
- **C-16 change to durable UI rules (feature 159).** `services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature`
  @AC-2/@AC-4 say the offline card shows "only" market value, unrealized and realized, with no Day P&L.
  The operator explicitly chose (sdd-story Q&A, 2026-10-19: "Trader account card" and "Book page
  offline card" as surfaces for Day P&L / Total P&L / fees / lifetime realized) to show the new figures
  on those cards. That choice supersedes the "only" wording for these fields. The rules' intent, that
  Cash, Buying Power and *broker* Day P&L are not faked, is kept. Update that suite at launch promotion.
- Warnings resolved:
  - The off-session mark is now defined (reference-session daily close when it exists, else the quote;
    AC-35).
  - Closed-in-session symbols count in account Day P&L (AC-34).
  - Baseline shares seeded inside the session count as overnight shares (AC-36).
  - `GetPortfolio` without an `account_id` sums each account's own figures (FR-9, AC-29).
  - AC-13 now asserts `total_pnl`, not the non-existent `Portfolio.unrealized_pnl`.
  - AC-1 and AC-34 were moved off rounding ties.
  - Net realized is UI-derived; AC-10 and AC-20 now assert gross values plus the UI net.
  - Added AC-32 ("No price" indicator) and AC-33 (agent `list_orders` / `list_positions` /
    `get_positions`).
  - AC-30 now names its rows.
  - FR-6 states that account-level figures are UI-only.
  - "Offline fees must not enter `fees_accum`" and "fit the last-close fetch in the quote-timeout
    envelope" moved to OQ-8 as design constraints. They can't be observed through the API.

## Session 2026-10-19 — sdd-review product-spec (round 3: PASS WITH WARNINGS → warnings addressed)

- Round-3 verdict: PASS WITH WARNINGS (0 blockers, 7 warnings, no Floor breach). All 36 scenarios
  verified arithmetically. The operator asked for every warning to be addressed.
- Operator decisions (explicit, 2026-10-19):
  - **W1, `GetPortfolio` covers broker accounts too.** `GetPortfolio` (which set no Day/Total P&L for any
    account) adopts the `ListPortfolios` per-account rule for broker accounts as well, and the aggregate
    sums them. This is the second deliberate broker-visible change, carved out of FR-8 (AC-39).
    `total_pnl_pct` is `optional` and set only for offline-only scopes (W7).
  - **W2, an omitted `fees` value is preserved** on re-confirm; only an explicit value replaces it (AC-37).
  - **N1, Total P&L uses lifetime realized**, not since-snapshot, so it doesn't drop at a snapshot. This
    reverses the round-1 FR-2 basis. Affected scenarios had their Givens restated in lifetime terms
    (AC-4/6/13/25/29); IDs are unchanged.
- Orchestrator fixes:
  - W3: no previous-session bar → overnight terms 0 and excluded from `base`; unpriced positions excluded
    (AC-38).
  - W4: `mark_as_of` encoding is defined (00:00 America/New_York of the bar's session date).
  - W5: AC-23 retitled. Consumption order is attribution-only (Day P&L totals don't depend on it); FR-1
    says so.
  - W6: AC-31 uses the detail page's real "Day P&L" label.
  - N3: NEW offline orders have no fees value.
  - N5: the session-calendar source is a design item (OQ-8).
  - N7: ledger citation fixed.
- **C-16 extension (N2):** the durable UI rule `services/xstockstrat-ui/acceptance/offline-account-portfolios.feature`
  @AC-13 ("Realized P&L = 97.50") is **extended**, not contradicted. The row is relabelled
  "Realized (since snapshot)" next to the new lifetime row. Recon should record it as EXTEND.
