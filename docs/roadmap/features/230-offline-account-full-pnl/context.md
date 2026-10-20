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

## Session 2026-10-19 — sdd-review product-spec (round 4: PASS WITH WARNINGS → approved)

- Product spec approved. Status: draft → spec-ready.
- Round-4 confirmation verified all round-3 items fixed and re-checked AC-1..AC-39 arithmetic (no
  rounding ties).
- Warnings addressed before the status change:
  - (A) FR-1's "order-invariant" claim is qualified for the missing-`previous_close` case, and AC-40 was
    added. The reviewer's suggested value (0) was wrong; overnight-first gives (50−48)×5 = 10.
  - (B) AC-31 restated as a Saturday read so its `day_pnl 50.00` is reachable:
    (180−185)×(−10) = 50.
- Notes addressed:
  - AC-10 and AC-11 got a read date (2026-12-01).
  - `mark_as_of` is unset for BROKER/NONE.
  - 157 UI @AC-13 extension named in FR-6.
  - GetPortfolio broker `Equity` and the `trading_mode` aggregate selection are added to OQ-8 as design
    items.
- Overlap findings (warnings only, no merge-order row):
  - 229 is merged; the branch includes it.
  - Land after 215 and rebase (`app/tools.py`, `mcp-tools.md`, `positions/[symbol]/page.tsx`).
  - Offline fees must not enter broker `fees_accum` (OQ-8).

## Session 2026-10-19 — sdd-design (Phase 0 recon)

- Wrote recon.md from six parallel recon passes: trading, portfolio, marketdata/proto, ui, agent, and
  the business-rules scan (scenario-recon).
- Central fork (R1): offline per-session fill data never reaches portfolio, the session rolls over
  with no event, and a portfolio→trading edge is forbidden (boot cycle). So Day P&L must be computed at
  read time from data trading pushes into portfolio's absolute-sync payload.
- New risks surfaced:
  - R2: no market calendar or America/New_York helper anywhere.
  - R3: marketdata `prev_close` isn't session-aware.
  - R4: `BatchGetBars` live fetch has no detached budget and fails the whole RPC on error.
  - R5: `ListConfirmedOfflineOrdersByAccount` lacks `DISTINCT ON (order_id)`.
  - R11: `fmtSignedUsd` places the minus sign wrong (renders `$-50.00`).
- C-16 flag: `@AC-4 @feature-178` ("same missing outcome under batching") may be an unsigned CHANGE
  under FR-5.

## Session 2026-10-19 — sdd-design round 1 (gate)

- Round 1 result: NEEDS WORK. No Floor breach; 2 C-16 blockers, 9 major and 7 minor objections. The
  core architecture held: trading pushes absolute data on the existing sync payload, and portfolio
  computes values at read time through one valuation step shared by every read path.
- Operator decisions (explicit, 2026-10-19):
  - **Frozen-window confirms keep feature 163 behaviour.** A confirm whose fill falls at or before the
    snapshot's `as_of` is accepted and ignored (`@AC-3 @feature-163` PRESERVED). Lifetime carry is
    fixed when the snapshot is taken; later edits to those orders do not change it. The proposed
    `FAILED_PRECONDITION` was dropped.
  - **C-16 sign-off for feature 178:** `@AC-4` and the third clause of `@AC-1`
    (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`) change for **offline
    positions only**:
    - a missing quote gets the last close;
    - an off-session read uses the session close;
    - a pre-session quote is ignored.
    Batching (one `GetLatestQuotes` call) and broker positions are unchanged. Rewrite both rules at
    promotion.
  - **Marketdata is changed (scope change):** `BatchGetBars` degrades per symbol. A failed cold live
    fetch returns the warm subset instead of failing the RPC (feature 229 precedent). Spec § Affected
    Services amended.
  - **New config key** `portfolio.marketdata.last_close_lookback_days` (default 21, bounded) instead of
    a constant. Spec § Config Key Changes and FR-5 amended. The spec's earlier "no new config keys" is
    superseded.
- Engineering fixes carried into round 2:
  - Trading emits fills from a calendar-free ~10-day window; portfolio alone owns the calendar.
  - The calendar package lives in portfolio, not `packages/proto`.
  - The previous session's date is derived from the bar data.
  - A live read excludes today's still-forming bar.
  - The same-session window gets an upper bound.
  - A snapshot header table holds the carry (the empty-statement case), and `as_of` changes on
    non-latest snapshots are rejected.
  - `DISTINCT ON` runs before the status filter.
  - The agent prints zero-valued fields (`always_print_fields_with_no_presence`).
  - `GetPortfolio` gains an ownership gate (a pre-existing realized-P&L leak; record it in findings).
  - The bar date mapping gets a golden test against real `ohlcv` rows.
  - The proposer must say whether a portfolio-side close memo is still needed now that marketdata is
    fixed.

## Session 2026-10-19 — sdd-design round 2 (gate)

- Round 2 result: NEEDS WORK. No Floor breach; 2 blockers, 7 major. The Day P&L algorithm was
  hand-verified against 15 scenarios. The calendar, the 10-day fill window, the header table and the
  migrations held up.
- Operator decisions (explicit, 2026-10-19):
  - **`BatchGetBars` degradation is opt-in.** A new `allow_partial` request flag (marketdata proto)
    turns it on. Portfolio sets it: the cold fetch is detached, budgeted from the caller's remaining
    deadline, and returns the warm subset. Analysis is untouched. This rejects round 2's universal
    degrade, `unavailable_symbols`, the analysis consumer change, and the new
    `marketdata.bars.batch_timeout_ms` key. It removes the `@AC-1 @feature-185` thin-history
    regression.
  - **`filled_at` is preserved on omit** when re-confirming an already-confirmed order; only a first
    confirm defaults to now. This designs out the frozen-window double-count and keeps
    `@AC-10 @feature-157` intact under baselines.
  - **C-16 sign-off: snapshot rule changes**, narrowing `@AC-6 @feature-163`:
    - (a) changing the `as_of` of a snapshot that is not the latest → `FAILED_PRECONDITION`;
    - (b) a re-submit whose rows are all rejected is a no-op;
    - (c) an empty position list records a full flatten.
    FR-4 was rewritten to state the carry window `(pred.as_of, S.as_of]`.
  - **GetPortfolio leak fixed by user-scoping reads.** Every account-keyed read (balance, offline
    state) is scoped by `user_id`; fields are omitted for an account the caller doesn't own. There is
    no PermissionDenied path, so new accounts keep rendering.
- Engineering fixes folded in:
  - the carry's predecessor lookup excludes the snapshot's own id;
  - the bars symbol set = positions ∪ recent-fill symbols in the session;
  - migration 017 backfills `source = ORDERS` for pre-163 offline positions;
  - a test pins that `GetPnL` and snapshot equity are unchanged;
  - `DeleteBaselinesByAccount` and the header purge run in one transaction;
  - spec drift (migration names, the 4 portfolio columns) is noted for `/sdd-spec`.
- Spec amended: FR-3 (`filled_at` preserve), FR-4 (carry window and snapshot rules), Affected Services
  (marketdata opt-in), Proto (`BatchGetBarsRequest.allow_partial`).
- Gate: operator chose a confirming round 3, then approval.

## Session 2026-10-20 — sdd-design round 3 (gate)

- Round 3 result: APPROVE WITH NITS. No Floor breach and no unsigned C-16 regression.
  - Verified against the code: the allow_partial mechanics (the deadline propagates
    handler→service), all 9 UpsertOrder callers, the 017 source backfill, and the AC-39 and
    AC-41..AC-54 arithmetic.
  - The first round-3 adversary run completed despite the worker restart. A duplicate re-run was
    stopped.
- Operator decision (explicit, 2026-10-20): **un-confirm keeps fees**, mirroring the filled_at rule.
  NEW orders never enter the fold. The RPC edge hides fees/filled_at on NEW orders. AC-48 now expects
  fees 2.00. The "fees cleared on un-confirm" limitation is removed.
- Fixes to fold in:
  - the ConfirmFillDialog label (stale "defaults to now");
  - agent `fees: float | None = None`, sent only when set;
  - the no-deadline partial fetch runs on the caller's ctx, not detached;
  - AC-53/54 made concrete and promoted to the marketdata @feature-191 suite;
  - a new limitation: previous-session bars that are permanently missing;
  - sqlmock pattern updates.
- Gate: operator chose to run round 4 before approving.

## Session 2026-10-20 — sdd-design round 4 (gate)

- Round 4 result: APPROVE WITH NITS. 0 blockers, 0 majors, 7 minors, no Floor breach, no C-16
  regression. The masking model was verified against the code (5 live response sites; ConfirmOrder's
  internal repo read stays unmasked).
- Minor fixes for round 5:
  1. Drop the dead `TradingService.StreamOrderUpdates` masking site; log the dead method in the trading
     findings.
  2. Default `filled_at` to now only when the derived status is non-NEW.
  3. Tag AC-53 and AC-54 with `@FR-5`; keep them in the feature's own acceptance file and promote them
     at launch.
  4. Replace the "state of @AC-41" cross-references with named preconditions. Fix AC-44's
     Given-assertion and missing positions. Give AC-53 an explicit status code.
  5. Reword the dialog as "(not shown while NEW)".
  6. Add the `+6h` offset as a fifth fixed invariant, and name a CLAUDE.md home for each invariant.
  7. Fix the citations and state `D1 = DayStart(ref + 1 calendar day)`.
- Gate: the operator chose round 5, the last one allowed.

## Session 2026-10-20 — sdd-design

- **Phase 0 recon:** wrote recon.md.
  - Services: trading, portfolio, marketdata, ui, agent, and the proto package.
  - Key reuse patterns: the absolute-snapshot recompute plus per-account lock (157 and 163), and the
    detach-and-degrade quote pattern (229).
- **Phase 1 grilling:** 5 rounds, full mode. The approach that won:
  - trading pushes fees, the frozen carry (a snapshot-header table) and 10-day recent fills on the
    absolute `account.positions.synced` payload;
  - portfolio owns the calendar and values everything at read time through one shared step for all
    portfolio reads;
  - marketdata `BatchGetBars` gets an opt-in `allow_partial` flag.
- **Rejected alternatives** (full list in design.md): a portfolio→trading edge; trading cutting fills
  by session; universal bars degradation, `unavailable_symbols` and an analysis change; a PermissionDenied
  gate on GetPortfolio; clearing fees or `filled_at` on un-confirm.
- **Constitution rules touched:** C-01, C-03, C-04, C-05, C-07, C-09, C-10(b), C-12, C-13, C-14, C-15,
  C-16, C-17, C-18; F-01, F-04, F-06, F-07. Five fixed invariants plus a coalescing interval were
  approved at the gate. No Floor breach in any round.
- **Business rules:**
  - CHANGE (all signed off): 229 @AC-1; 178 @AC-4 and @AC-1 (offline only); 163 @AC-6 (narrowed);
    159 @AC-2 and @AC-4.
  - EXTEND: 157 @AC-13; 163 @AC-14; marketdata AC-53/54, promoted at launch into a new suite.
- **Acceptance:**
  - AC-41..AC-54 appended. AC-43..AC-47 share a `Rule:` + `Background:`, the first use of `Rule:` in
    the repo; it is valid Gherkin and no CI step parses `.feature` files.
  - AC-10 clarified in place.
  - Fixed pre-existing double `Given` slips in AC-10 and AC-11.
- **Open risks carried to /sdd-spec:**
  - the bar-date mapping golden test (blocking);
  - migration-number recheck;
  - manual `buf breaking` for trading.proto;
  - spec drift (migration names, 4 columns, FR-3 note);
  - findings to log.
  All are listed in design.md § Open Risks.
- **Ledger:** fails.md (trace response sites from RPC registration; make shared-RPC behaviour changes
  opt-in); insights.md (push raw bounded inputs, interpret where the clock lives).
- **Status:** spec-ready → design-approved.

## Session 2026-10-20 — sdd-spec

- Generated implementation-spec.md with 28 steps. Status → implementation-ready.
- **Evidence re-anchored on `origin/main-dev` @ `7c247698`.** Feature 231
  (`fix-after-hours-positions-priced`) merged after /sdd-design. It changed `portfolio_service.go`
  (`markOf` `:446-456`, `enrichPosition(p, price)` `:559-566`), `marketdata_service.go` (`BatchGetBars` is
  now `:703-812`; the cold-fetch return is `:789-791`), `marketdata.proto` (`Quote.mark_price = 8`) and
  `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:100-144`). It also added the Go fixture home
  `services/xstockstrat-portfolio/internal/testdata/marks.go`. Trading, UI and agent code were unchanged,
  so the design's citations there still hold.
- **Open risk closed: golden bar-date mapping.** Staging `query_bars` (AAPL) shows 1d bars stamped 00:00
  America/New_York: `2026-10-16T04:00Z` (EDT), `2026-01-16T05:00Z` (EST), and across the DST end
  `2025-10-31T04:00Z` → `2025-11-03T05:00Z`. `SessionDate` = NY date of `t+6h` maps all of them correctly,
  and Step 16 pins them as the golden vectors. The same read showed today's forming bar is stored during
  the session, which confirms the AC-49 exclusion is needed.
- **Open risk closed: migration numbers.** I scanned all 63 `origin/*` heads: none carries trading `011+`
  or portfolio `017+`.
- **Spec drift landed in product-spec.md:**
  - migration `011_offline_fees_snapshot_headers` with the headers table (OQ-2 resolved in trading);
  - portfolio 017 adds 4 columns plus the `source` backfill;
  - the FR-3 NEW-order note.
- **New design gap, escalated, not guessed (P-03): D-1.**
  - The 231 durable rules `@AC-6`/`@AC-14 @feature-231` (offline position, one-sided quote, no in-bound
    close → `current_price 0`) conflict with FR-5's 21-day last-close fallback once 017 routes every offline
    position through the valuation step.
  - The spec defaults to this: for offline positions, only a **two-sided, fresh** quote is a QUOTE mark; a
    one-sided quote falls to the bar close (LAST_CLOSE, real date). That preserves 231 @AC-1/@AC-13 values
    and changes @AC-6/@AC-14 row 2 for offline positions only.
  - **Operator sign-off (C-16) or an alternative is required before Step 19 executes.**
- **Implementation detail added (not in design):** a narrow `barsBatchStore` seam in marketdata. `s.repo`
  is a concrete pool-backed type, so AC-53/54's warm subset is not unit-testable without it. It follows
  231's `quoteStore`/`dailyCloseReader` nil-seam pattern (`marketdata_service.go:117-136,225-230`).
- Other key findings:
  - `UpsertBaselineSnapshot`/`DeleteBaselinesByAccount` run on `r.pool`, so the header transaction is
    proven by SQL shape plus the service fake;
  - `EffectiveBaselineByAccount` reads through `r.db`, so pgxmock can drive it;
  - `UpsertOfflineRealized` moves to `r.db.Exec` so it can be mocked;
  - the AC-43..47 S1 history moves to `services/xstockstrat-trading/internal/testdata/offline_history.go`
    (two consumers, C-13).

## Open Threads

- [x] Golden test of `SessionDate` against real staging `ohlcv` 1d rows (EDT, EST, DST end). Verified at
  /sdd-spec; pinned as Step 16 (blocking for Step 19).
- [x] Re-check migration numbers trading 011 / portfolio 017 across remote branches. Done (63 heads, no
  collision).
- [ ] Manual `buf breaking` on trading.proto (CI skips it, `ci.yml:135`). Target: Step 1 Verification.
- [x] Land spec drift: migration names; portfolio 017 adds 4 columns; FR-3 NEW-order note. Done in
  product-spec.md.
- [ ] Findings: dead `TradingService.StreamOrderUpdates` (trading); unscoped `GetOfflineRealized` leak
  (portfolio); `fmtSignedUsd` sign placement (UI). Target: Step 28.
- [x] **D-1: operator sign-off (C-16) on 231 `@AC-6`/`@AC-14` (row 2) for offline positions, or an
  alternative mark rule.** Resolved 2026-10-20: the default ("fallback wins") was signed off. See the
  session entry below. Step 19 is unblocked.

## Session 2026-10-20 — D-1 decision (post sdd-spec)

- **Operator decision D-1 (explicit, 2026-10-20): "fallback wins" (the spec's default). C-16 sign-off.**
  - For **offline** positions, a quote counts as live only if it is two-sided and from the current
    session.
  - Anything else falls back to the daily close within `portfolio.marketdata.last_close_lookback_days`,
    flagged `MARK_SOURCE_LAST_CLOSE`, or `MARK_SOURCE_NONE` if no bar exists.
  - This changes the durable rules `services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`
    `@AC-6` (one-sided quote with a close older than 168h → price 0) and `@AC-14` row 2 (no mark →
    price 0), **for offline positions only**. Rewrite both at promotion.
  - `GetPnL` and broker positions keep feature 231's behaviour; 231 `@AC-1`/`@AC-13` prices are
    unchanged.
  - The rejected alternative (capping the offline fallback at 168h) would have narrowed the operator's
    21-day lookback choice.
- Step 19 is unblocked. Verified: feature 231 is on `main-dev`, promoted to `main` in #1258.

## Session 2026-10-20 — sdd-review impl-spec (advisory)

- Result: 6 ✗ and 10 ⚠ (advisory, did not block). The operator asked for all of them to be addressed
  before execution, and every item below was fixed in `implementation-spec.md` before any step ran
  (F-09 freezes step bodies only during execution).
- Items found and how each was resolved:
  - [x] Steps 7→8/10→11 (F-05): Step 7 now adapts both baseline-store call sites (`trading.go:949`, and
    `:1125` with a nil carry meaning 0) and the fake's signatures, so `go vet ./...` passes from Step 7.
    Step 7 has its own verification.
  - [x] Steps 17→18/20→21 (F-05): `GetOfflineRealized` is kept until Step 21. Step 21 moves both callers,
    deletes it and removes its two repo tests in the same step.
  - [x] Step 20 (C-01/F-04/F-08): `posRow` is now described correctly (it hard-codes `source` 0 and is not
    changed). A source-aware `offlinePosRow` helper goes in the listed test file. The C-13 grep check is a
    real assertion now.
  - [x] Step 6: "3 existing SELECT regexes" (was 4).
  - [x] Steps 10/12: the ConfirmOrder harness is `repository.NewTradingRepoWithDB(pgxmock)`. Confirmed
    orders reach the fake through an `ordersFn` mirror of `svc.orders`. Step 10's grep check is fixed to a
    real `test … -eq 0` on `internal`, with exported `S1*ID` constants.
  - [x] Step 13: line drift fixed (repo field `:37`, assigned at `:206`).
  - [x] Step 14: the strict-path INTERNAL check is asserted at service level; no handler test file is
    touched.
  - [x] Step 17: `UpsertOfflineRealized` keeps `accountID/userID/tradingMode` as positional args.
  - [x] Steps 19/21/22 (AC-34/AC-6):
    - account valuation is driven by the in-scope offline account IDs, so flat accounts are valued;
    - a `GetOfflineStates` error is non-fatal (WARN, empty map);
    - `valueAccounts` reuses the fetched marks;
    - Step 22 asserts flat accounts on both GetPortfolio and ListPortfolios, plus the error case.
  - [x] Step 24: the `get_positions`/`get_positions_by_account_id` docstrings are updated together with
    `mcp-tools.md` (197 parity).
  - [x] Step 26: the 9-file scope is kept on purpose, with a justification note (no consumer outside
    these surfaces; C-08, C-18).
  - [x] Step 27: the vitest `thresholds.lines: 40` gate is stated.
  - [x] Coverage: AC-13 added to Step 20 Covers; AC-1 account level asserted in Step 22; AC-18 backfill
    half added to Step 3 (SQL-shape proof). All of AC-1..54 are covered.
  - [x] Cross-doc:
    - product-spec FR-5 now states the D-1 rule and the 231 @AC-6/@AC-14 change;
    - the stale D-1 paragraph in the Execution Summary is rewritten as resolved;
    - the promotion wording is aligned ("rewrite at promotion").
- Overlap findings:
  - No migration, proto or config-key collision.
  - Feature 215's nine shared files are already on `main-dev` (#1243), so nothing needs rebasing.
  - Merge-order row 231↔230 resolved (`b21dbc4b`).

## Session 2026-10-20 — sdd-execute (sequential)

- Operator choices: **sequential mode**, development branch `feature/offline-account-full-pnl` (pushing it
  was authorized). The branch was created from `origin/main-dev` (`37b9a562`) with the spec docs merged in
  (a fast-forward to `1f4c8f40`).
- Re-spec gate: no edits needed. Since the spec anchor (`7c247698`), the only `services/`/`packages/`
  changes on main-dev are the agent dependency bump and CI sync tooling; no spec evidence moved.
- Tooling setup (Steps 1–28):
  - go1.27 ✓ (auto-download)
  - golangci-lint ⬇ v2.14.0 (was 2.5.0)
  - dockerd ⬇ started
  - `xstockstrat-codegen` image ⬇ built (buf 1.72.0 + pinned plugins)
  - Node ⬇ v24.22.0 at `/opt/node24` (host default was 22; CI uses 24)
  - pnpm ⬇ 9.15.9 on Node 24; `pnpm install --frozen-lockfile` ✓
  - agent `uv sync --extra dev` ✓; Go modules downloaded ✓
  - No database installed (migrations are verified offline).

### Step 1 — proto: additive fees, P&L, mark-provenance and allow_partial fields [done]
- Added:
  - `ConfirmOrderRequest.fees = 6` and `Order.fees = 23`;
  - `Portfolio` fields 13–16;
  - `Position.mark_source = 24` / `mark_as_of = 25`, plus the new `MarkSource` enum;
  - `BatchGetBarsRequest.allow_partial = 6`.
- Verified inside the pinned codegen image (buf 1.72.0): `buf lint` ✓, `buf breaking` ✓, and the manual
  `trading.proto` `buf breaking --path` check ✓ (C-09; CI skips trading.proto).
- TDD: N/A (proto).
- Files modified: `packages/proto/{trading,portfolio,marketdata}/v1/*.proto`
- Deviations: none.

### Step 2 — proto-gen: regenerate stubs [done]
- Regenerated Go, Python and TS stubs (plus the compiled `dist/`) with `./scripts/buf-gen.sh` inside the
  pinned `xstockstrat-codegen` image: 24 files. Most of the churn is raw descriptor bytes and portfolio
  enum indexes shifting because `MarkSource` was inserted.
- A second run produced an identical tree (proto-freshness ✓). `go build ./...` passes for trading,
  portfolio and marketdata.
- TDD: N/A (generated).
- Files modified: `packages/proto/gen/**`
- Deviations: none.

### Step 3 — migration: trading 011 — order fees + snapshot headers [done]
- `011_offline_fees_snapshot_headers.{up,down}.sql` per design §2.1:
  - `orders.fees NUMERIC(18,8)`, backfilled to 0 for confirmed offline orders;
  - the `offline_snapshot_headers` table, its account/as_of index, and header rows backfilled from
    existing baselines (carry 0).
- Down drops the table and then the column.
- Offline check ✓: 011 is next after 010; every ADD/CREATE in up has an inverse in down. No DB started.
- TDD: N/A (migration).
- Files modified: the two 011 files. Deviations: none.

### Step 4 — migration: portfolio 017 — lifetime/fees/recent-fills columns + source backfill [done]
- `017_offline_realized_lifetime_fees.{up,down}.sql` per design §4.1:
  - adds `realized_carried`, `fees_since_snapshot`, `fees_carried` (DOUBLE) and `recent_fills` (JSONB
    `'[]'`);
  - sets `source = 1` (ORDERS) on pre-163 offline positions.
- Down drops the 4 columns; the source backfill is intentionally not reverted.
- Offline check ✓: 017 is next after 016; 4 ADD ↔ 4 DROP. No DB started.
- TDD: N/A (migration).
- Files modified: the two 017 files. Deviations: none.

### Step 5 — service: trading repo — persist/read `fees`; dedupe confirmed offline orders [done]
- `UpsertOrder` writes `fees` as `$23` straight from `*float64`: nil → NULL, 0 → 0, no `nullableFloat`.
  The conflict update gains `fees = EXCLUDED.fees`.
- `intentLateralJoinSQL` became `intentLateralJoinOn(alias)`, used by every reader. `scanOrder` reads a
  nullable `fees`, and all 4 SELECTs add it.
- `ListConfirmedOfflineOrdersByAccount` now picks the latest row per order (`DISTINCT ON (order_id)`)
  **before** the status filter (R5). `testdata.OrderRowColumns`/`NewOrderRow` gain `fees`.
- TDD (with Step 6), red: 6 tests failed for the right reasons (SQL had no `fees`; no `DISTINCT ON`;
  fixture had no `fees` column) → green: all passed.
- Files modified: `internal/repository/trading_repo.go`, `internal/testdata/order_rows.go`.
- Deviations: none.

### Step 6 — test: trading repo fees round-trip and dedupe [done]
- Added `TestUpsertOrder_PersistsFeesPresence` (typed-nil → NULL, explicit 0 → 0),
  `TestScanOrder_FeesNullVsZero` (AC-18 repo half) and
  `TestListConfirmedOfflineOrdersByAccount_DistinctOnBeforeFilter` (SQL-shape proof only).
- The 3 existing SELECT regexes now require `filled_at, fees, li.state`. Comments renamed to
  `intentLateralJoinOn`.
- Verification:
  - targeted ✓;
  - full suite with `-race` ✓, total 72.6% (≥ 40%);
  - `golangci-lint` v2.14.0 0 issues. Lint had to be rebuilt with go1.27: a go1.26 build refuses the
    module's 1.27 target.
- Files modified: `internal/repository/trading_repo_test.go`.
- Deviations: none.

### Step 7 — service: trading baseline repo — snapshot headers, carry callback, atomic purge [done]
- Added `SnapshotHeader`, `CarryFunc` and `ErrSnapshotAsOfConflict`.
- `UpsertBaselineSnapshot(..., carry)` runs in one tx:
  - locks the account's headers `FOR UPDATE`;
  - keeps the stored carry on same id + same `as_of`;
  - rejects a non-latest or backwards `as_of` change;
  - otherwise picks `pred` (greatest `(as_of, created_at)` below `as_of`, own id excluded), loads its
    lots, and calls `carry`; a nil carry gives 0, 0;
  - upserts the header, then DELETE+INSERT of the rows.
- `EffectiveBaselineByAccount` → `(hdr, ok, err)`: latest header first (`QueryRow`), then its rows
  `qty <> 0`. A header with no rows is a full flatten (ok=true).
- Rows load through a shared `snapshotLots(ctx, dbQuerier, …)`, used by both the read path (`r.db`) and
  the upsert tx (`pgx.Tx` satisfies `dbQuerier`).
- `DeleteBaselinesByAccount` purges rows and headers in one tx.
- Interface and call sites adapted mechanically: `hdr.AsOf`/`hdr.Lots`, and `nil` carry at the snapshot
  call site until Step 11. The fake's signatures were adapted with no behaviour change.
- Verification:
  - `go build` / `go vet` ✓;
  - 21 Snapshot|OfflineRecompute tests ✓.
- TDD: Step 8's header test was written first. Red came as a compile failure (3 vs 4 return values);
  the old signature can't express the full-flatten case behaviourally. Green: 3/3 subtests.
- Files modified: `internal/repository/offline_baseline_repo.go`, `internal/service/trading.go`,
  `internal/service/trading_offline_test.go` (signatures only).
- Deviations: none.

### Step 8 — test: trading baseline repo — header read + fake update [done]
- Added `offline_baseline_repo_test.go` `TestEffectiveBaseline_HeaderThenRows` with 3 subtests:
  - header carry plus `qty=0` dropped;
  - header without rows = full flatten, `ok=true`;
  - no header = `ok=false`.
- The comment there records that the upsert/purge tx SQL is proven by SQL-shape review only.
- `fakeBaselineStore` now models headers:
  - map + seq standing in for `created_at`;
  - keeps the carry on same id + same `as_of`;
  - `ErrSnapshotAsOfConflict` on a non-latest or backwards change;
  - `pred` excludes its own id;
  - invokes `carry`;
  - `EffectiveBaselineByAccount` prefers the latest header; `DeleteBaselinesByAccount` clears headers.
- Behaviour note: in the fake, an empty-rows upsert is now a full flatten (`ok=true`), matching the
  repo. No existing service test depended on the old `hasBaseline=len(rows)>0`; the full service
  suite is green.
- Verification:
  - targeted repo test ✓;
  - `go vet` ✓;
  - `golangci-lint` 0 issues.
- Files modified: `internal/repository/offline_baseline_repo_test.go` (new),
  `internal/service/trading_offline_test.go`.
- Deviations: none.

### Step 9 — service: trading ConfirmOrder — fees, filled_at rules, NEW-order masking [done]
- Fee validation runs before the load: `< 0`/NaN/±Inf → `InvalidArgument` "fees must be >= 0", so it
  wins over the broker `FailedPrecondition`.
- Fees: a supplied value replaces the stored one; omitted keeps it; nil defaults to 0.
- `filled_at`:
  - a supplied value is used only when the order isn't NEW;
  - otherwise a stored value is kept;
  - otherwise `now` when not NEW, else nil.
- `hideUnconfirmedFill` sits next to `normalizeFilledQty`. It is OFFLINE+NEW only and runs at:
  - both GetOrder paths;
  - both ListOrders loops;
  - the ConfirmOrder response, a clone, so `s.orders` keeps the unmasked order.
- `StreamOrderUpdates` is untouched (finding for Step 28).
- TDD (with Step 10):
  - red: 7 tests failed for the right reasons. A temporary no-op `hideUnconfirmedFill` stub turned the
    compile red into a behavioural one; the stub was removed in green.
  - green: 9/9 with `-race`.
- Files modified: `internal/service/trading.go`.
- Deviations: none.

### Step 10 — test: trading ConfirmOrder fees, filled_at preservation and masking [done]
- Added `internal/testdata/offline_history.go`: S1 history builders plus id constants, the AC-43..47
  Background (C-13).
- The harness `confirmHarness` (pgxmock + `NewTradingRepoWithDB`) round-trips every order through the
  **real** `UpsertOrder` → `scanOrder` SQL:
  - `rowCapture` arg matchers record each write, and the write is served back as the next `GetOrder`
    row;
  - the seed itself goes through `UpsertOrder`, so no status/side encoding is duplicated in tests;
  - pointer columns are re-pointered for pgxmock.
- Tests: AC-9 (−1/NaN/+Inf before load, `ExpectationsWereMet` with zero expectations), AC-8, AC-37,
  AC-21, AC-47, AC-48 (ConfirmOrder + GetOrder masked, cache unmasked, bare re-confirm restores), the
  qty-0 never-filled case, and broker-untouched.
- Deviation (harness detail): the spec named a fake `ordersFn`. I used the capture/replay of
  `UpsertOrder` binds instead, which is a stronger proof because it exercises the persisted shape.
- Verification:
  - targeted `-race` ✓;
  - full `-race` coverage total 72.6% (≥ 40%);
  - `golangci-lint` 0 issues;
  - `ord-s1` literal guard ✓.
- Files modified: `internal/service/trading_offline_test.go`, `internal/testdata/offline_history.go`
  (new).

### Step 11 — service: trading recompute payload + snapshot carry flow [done]
- Recompute adds `fees_since_snapshot` (Σ `GetFees()` over the same window the fold uses, so
  frozen-window fees are excluded), `realized_carried` / `fees_carried` from the header (0 without a
  baseline), and `recent_fills` (window fills with `filled_at ≥ now−10d`, signed qty, RFC3339Nano).
- `const offlineRecentFillsWindow = 10 * 24h`.
- Snapshot:
  - a non-empty, all-rejected list returns committed 0 plus the rejections before the lock (no upsert,
    no emit); an empty list still commits a full flatten;
  - `ErrSnapshotAsOfConflict` → `FailedPrecondition` "cannot change as_of of a snapshot that is not
    the latest".
- Deviation:
  - What changed: the carry is the pure `offlineSnapshotCarry(confirmed)`. The confirmed orders are
    loaded under the account lock just before `UpsertBaselineSnapshot`, not from inside the callback.
  - Why: this keeps the callback DB-free while the upsert tx holds `FOR UPDATE` (no second pool
    connection inside the tx), matching the `CarryFunc` doc comment.
  - Effect: same result under the per-account lock, which ConfirmOrder also holds. A load error maps to
    Internal.
- TDD (with Step 12):
  - red: 24 failures, all for the right reasons (payload keys absent; all-rejected persisted 1→2;
    conflict surfaced as Internal);
  - green: all pass with `-race`.
- Files modified: `internal/service/trading.go` (gofmt also realigned the emit map's existing keys).
