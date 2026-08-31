# Context: signal-performance-attribution

**Feature**: `docs/roadmap/features/029-signal-performance-attribution/feature.md`
**Product Spec**: `docs/roadmap/features/029-signal-performance-attribution/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/029-signal-performance-attribution/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 029.
- Requires proto addition (GetAttribution RPC) and additive DB migration (signal_id column on orders).
- Key design decision: winner-takes-all attribution by highest-weight signal in V1; fractional multi-signal attribution deferred to V2.
- Practical dependency: needs 20+ closed paper trades before metrics are meaningful.

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (section order, C-14 Consumer Surface checkboxes, split Acceptance Criteria) **in place** — kept feature number **029** and directory `029-signal-performance-attribution`; no new numbered dir created.
- Preserved all existing scope: 7 FRs unchanged, all affected services, the non-breaking proto change (`GetAttribution` RPC + additive `signal_id` field on order submission) and the additive DB migration (nullable `orders.signal_id` + composite index `orders(signal_id, status, closed_at)`) intact; both open questions carried forward.
- Moved the previously inlined `## Acceptance Criteria` numbered list out into new `acceptance.feature` (9 `@AC-*` scenarios, every FR-N covered); the spec section is now a C-15 pointer only.
- Added a "Known traps" block to Open Questions from the Ledger: attribution lives on the order not the position (exit-cooldown insight), owner-scope every attribution query (131 IDOR fail), ordinal conviction ≠ cardinal weight (mpt/023), source-enum-subset propagation (signal-source-registry), P&L parity across read paths (056/C-10(b)). Status left at `draft`.

## Session 2026-08-31 — sdd-review fixes (product-spec)

`/sdd-review product-spec` returned **FAIL**; applied every item. Status stays `draft` (number/slug unchanged).

- **Fractional-attribution reconciliation (BLOCKER).** Resolved the self-contradiction between Out-of-Scope and `@AC-5`. Committed **V1 = winner-takes-all by highest input weight, with an equal split ONLY on an exact tie**. FR-3 rewritten to say so; Out-of-Scope now reads "fractional attribution across *non-tied* multi-signal inputs is V2; the exact-tie equal split is the only V1 fractional case"; `@AC-5` renamed to flag it as the only V1 fractional case and cross-references AC-4 (winner-takes-all).
- **FR-1 phantom service.** Committed FR-1 to the analysis `GetAttribution` gRPC RPC; deleted the "insights service HTTP endpoint" alternative. Clarified everywhere that `/insights` is a **segment of `xstockstrat-ui`**, not a service.
- **FR-2 ↔ FR-3 modeling gap + 042 reuse (DRY).** Reframed FR-2 from a lone scalar `signal_id` (which can't carry a multi-source weight vector) to persisting the **signal-attribution inputs** (contributing source(s) + per-source input-weight vector) on the order at submission. Directed reuse of feature 042 (`042-order-snapshots-pnl-patterns`, **launched**) `SignalEntry { name, value, source }` / `OrderSnapshot` shape rather than a parallel one. Added a Design-Phase Decision to reconcile 029's `GetAttribution` with 042's existing `QueryPnLPatterns` / `FactorType.FACTOR_TYPE_SIGNAL` / `SignalEntry` / `OrderSnapshot` (reuse-vs-new RPC).
- **DB schema-name corrections (code-grounded against real migrations).**
  - Removed the phantom `orders(signal_id, status, closed_at)` index — **`closed_at` does not exist** on `trading.orders`. New candidate index over existing columns: `orders(user_id, signal_id, status)` + the real fill timestamp `filled_at` (added by trading migration `008`); exact index resolved at `/sdd-spec`.
  - Fixed `ingest.signals` → **`ingest.newsletter_signals`** (the real table); noted `ingest.signal_sources` has **no `id`** column — PK is `slug TEXT`, join is `newsletter_signals.source = signal_sources.slug`. Deleted the illegal three-way cross-schema raw SQL join (per-service ownership + gRPC-only); storage/composition (gRPC edges vs. single-service derived/materialized table) is a Design-Phase Decision.
  - Stated the paired `NNN_*.down.sql` is required (**C-07**); the nullable attribution-column migration continues from the last file `009_offline_position_baselines` → **`010`**.
- **Trading C-3 / C-5.** Added a "Trading Service Impact" note: C-3 — feature is mode-agnostic / paper-testable (changes no execution path); C-5 — attribution reads position-level realized P&L, so partial-vs-full fill status is unaffected.
- **Open Questions reorganization (criterion 9).** `## Open Questions` now reads "None — resolved or moved below" (no unchecked `- [ ]` remain). The fractional question is resolved inline; the storage-model and 042-reconciliation questions moved to a new `## Design-Phase Decisions (owned by /sdd-design)` section (plain bullets); the five Ledger known-traps moved to a new `## Design Guardrails` section.
- **Proto scope kept accurate.** `GetAttribution` + messages are additive to `analysis.proto` (new RPC/messages, no `Opportunity` field change → no field-number collision with 095/110); the trading order-submission attribution inputs are additive (`buf breaking` stays green).
- Consistency edits to `acceptance.feature`: `@AC-3` reworded from "signal_id" to "signal-attribution inputs"; `@AC-5` clarified as the exact-tie / only-V1-fractional case. All `@AC-*`/`@FR-*` tags and coverage preserved.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

## Session 2026-08-31 — sdd-design (FULL, provisional)

- Phase 0 Recon: wrote `recon.md`. Services surveyed: analysis, trading, portfolio (realized-P&L
  source), ingest, ledger, ui, packages/proto. **Key reuse patterns:** feature 042's
  `analysis.pnl_positions` (sealed realized P&L, user-scoped) + `analysis.order_snapshots.signals`
  (per-order `{name,value,source}` capture) + ingest `ListSignalSources` (slug→display_name) + UI
  `DataTable`/`usePnLPatterns` sibling.
- Phase 1 Grilling: 2 rounds (full), **self-run** proposer/adversary (isolated subagent, no
  `AskUserQuestion`; per fails.md 2026-08-08 121/122/123 the forks below are surfaced to the operator
  for the live gate — this session did **not** flip lifecycle status).
- **Chosen approach:** 029 collapses into a new **additive read-side `GetAttribution` RPC** in
  analysis aggregating 042's already-persisted `pnl_positions` + `order_snapshots.signals`
  (winner-takes-all by highest ingest conviction; exact-tie equal split; no-signal → `manual`).
  **No trading migration 010, no `PlaceOrder` weight-vector, no cross-schema join.** UI = new
  `/insights/attribution` page + `PLATFORM_SUBNAV` entry + nav-reachability test.
- **Rejected:** product-spec-literal producer-side stamping (duplicates 042; trading has no causal
  weight vector — `PlaceOrderRequest` has no signal field); aggregating `pnl_pattern_samples` (drops
  the conviction value → can't do winner-takes-all); extending `QueryPnLPatterns` (symbol/factor
  shape, not date-range/per-source).
- **Proto collision check:** `GetAttribution` + new messages are additive; `Opportunity` is untouched
  → **no field-number collision with features 095/110**. No other feature plans `GetAttribution`.
- Constitution rules touched: C-01/C-04/C-07/C-09/C-10(a)/C-10(b)/C-12/C-13/C-14/C-16/C-17, P-03,
  F-06. **No Floor breach** (C-10(b) is a Commandment, not a Floor).
- **Open decisions for the operator (block a final gate):**
  1. Drop producer-side scope — realize FR-2 via 042's capture (confirm).
  2. FR-3 "highest input weight" = highest ingest **conviction** at order time (proxy; confirm).
  3. **AC-6 net-of-fees is unbuildable today** — no realized-P&L figure nets fees (shared
     `pnl.RealizedDelta` is price-only) and `order.filled` carries no fee field. Option A (redefine
     AC-6 to gross authoritative figure — C-16 CHANGE + sign-off, recommended) vs Option B (add
     fee-capture plumbing across trading→ledger→042).
- Status left at `spec-ready` (artifacts written; the design-approved flip is deferred to the live
  operator gate on the three decisions above).

## Session 2026-08-31 — design revision (operator gate closed; two confirmed decisions)

Revised `design.md`, `product-spec.md`, and `acceptance.feature` per two operator-confirmed decisions.
No code, no `status.md` change.

- **Decision #1 CONFIRMED — reuse 042, drop producer-side.** 029 is a single additive read-side
  `GetAttribution` RPC in analysis aggregating 042's already-persisted `analysis.pnl_positions`
  (user-scoped realized P&L + `closed_at`) and `analysis.order_snapshots.signals` (`{name,value,source}`
  + conviction). **No `trading.orders` migration, no `PlaceOrder` weight vector** — grounded: orders
  carry no signal field (`trading.proto:96` / `PlaceOrderRequest`), no causal score→order weight exists.
  Former "trading migration 010" plan withdrawn. FR-3 "highest input weight" = highest captured
  conviction (`order_snapshots.signals[].value`).
- **Decision #2 CONFIRMED — net-of-fees wins via additive fee plumbing (the new design work).**
  Investigated the real fill path:
  - **Honest verdict: Alpaca does NOT expose per-fill fees on the order/fill path.** `AlpacaOrder`
    (`internal/broker/alpaca.go:76-97`) parses no fee; `broker.BrokerOrder` (`broker.go:15-29`) has
    none; `order.filled` emit (`internal/service/trading.go:1712-1717`) carries only
    `{order_id,symbol,qty,fill_price,user_id,trading_mode,account_id}`. US equities are commission-free;
    SEC/TAF regulatory fees exist only in the Account Activities API (`/v2/account/activities`,
    end-of-day-aggregated `FEE`/`REG`/`TAF`), not per-fill — and trading has no activities integration
    (grep empty). Realized P&L today (`packages/proto/pnl/pnl.go:17-29`) is price-only/gross.
  - **Designed seam (additive, non-breaking):** add `Fees` to `broker.BrokerOrder` (Alpaca leaves 0) →
    stamp additive `"fees"` key on the `order.filled`/`order.partially_filled` **Struct** payloads
    (ledger payload is `google.protobuf.Struct`, `ledger/v1/ledger.proto:27` → **no proto change**,
    `buf breaking` green) → portfolio fold accumulates it into a **new `portfolio.positions.fees_accum`
    column (migration `014`)** alongside `realized_accum` (`portfolio_service.go:288-307`,
    `portfolio_repo.go:57-88`) → emit additive `"fees_total"` on `portfolio.position.closed` (existing
    `realized_pnl` stays GROSS/authoritative — preserves 042's shipped page + `GetPnL`, C-10(b)/C-16) →
    042 consumer (`pnl_pattern_consumer.py:256-283`) persists it to a **new
    `analysis.pnl_positions.fees_total` column (migration `021`, + `(user_id,closed_at)` index)** →
    `GetAttribution` win test computes net = `realized_pnl − fees_total`.
  - **Migrations added:** portfolio `014_positions_fees_accum.{up,down}.sql`; analysis
    `021_pnl_positions_fees_total.{up,down}.sql` (replaces the earlier optional-index-only 021). Both
    additive `NOT NULL DEFAULT 0`, paired down. F-01/F-06 honored (new numbered migrations, no new
    pool/service).
- **AC-6 kept net-of-fees (now buildable)** — the earlier "redefine to gross (C-16 CHANGE)" option is
  **withdrawn**; AC-6 is net-new, not a change to any existing rule. Added `@AC-10` (concrete: a $1.20
  fee on `order.filled` → `fees_total=$1.20`, unchanged gross `realized_pnl=$1.00` → net −$0.20 =
  loss) and `@AC-11` (no fee data ⇒ net == gross). All `@AC/@FR` tags preserved.
- **Open Risk carried:** Alpaca-sourced `fees` = 0 until a **named follow-up** sources regulatory fees
  from the Activities API and matches them to fills/positions; seam is correct end-to-end and unit
  tests prove the subtraction with injected fees. UI labels P&L "net of fees (broker regulatory fees
  pending)".
- **No Floor breach.** Constitution touched: C-01/C-04/C-07/C-09/C-10(a)/C-10(b)/C-12/C-13/C-14/C-16/
  C-17, P-03, F-01, F-06.

## Session 2026-08-31 — sdd-spec

- Generated `implementation-spec.md` with **15 steps**. Status → `implementation-ready`.
- **Migration NNNs verified next-free (fails.md 081 numbering trap re-scan):** portfolio
  `014_positions_fees_accum` (last existing `013_positions_provenance`); analysis
  `021_pnl_positions_fees_total` (last existing `020_job_schedule`). Both paired up/down, additive
  `NOT NULL DEFAULT 0`; analysis `021` also adds the `(user_id, closed_at)` index.
- **Proto additive, no collision confirmed by grep:** `GetAttribution`/`GetAttributionRequest`/
  `SourceAttribution`/`GetAttributionResponse` appear **nowhere** in `packages/proto/`, `services/`, or
  other feature dirs; `Opportunity` (`analysis.proto:542`) untouched → no field-number collision with
  095/110. Fee seam adds **no** proto (Struct payload keys).
- **Two /sdd-spec decisions surfaced (C-11):** (1) `SourceAttribution.trade_count`/`win_count` are
  **`double`**, not int32, so FR-3's exact-tie 0.5/0.5 split (AC-5) is representable; AC-1's integer
  counts are exact doubles. (2) `avg_return` is a **percent over an approximate cost basis** (earliest
  order_snapshot price×qty; cost_basis==0 trades excluded from the mean only) — resolves recon's
  "avg return % has no denominator" risk. No `@AC-*` asserts a numeric `avg_return`.
- **Grounded correction to design's `:731-732` fee-emit reference:** the ONLY `order.filled`/
  `order.partially_filled` emit sites are `trading.go:1712`/`:1728` (the `pollFills` path); the
  submit-time path emits `order.broker_submitted`, not `order.filled`, so the `"fees"` stamp lands at
  1712/1728 where `brokerOrder` is in scope.
- **Every `@AC-*` covered by a test step:** AC-1/3/4/5/6/7/9/10/11 → Step 12 (analysis handler test);
  AC-2/8 → Step 14 (UI e2e); AC-10 also spans Steps 6/8/10 (trading→portfolio→analysis fee seam);
  AC-11 also Step 8. C-14 UI surface landed (Steps 13–14, `/insights/attribution` + PLATFORM_SUBNAV +
  nav-reachability); Agent not required.
- **Reviewers (deduped):** Proto Reviewer, DBA, xstockstrat-analysis, xstockstrat-portfolio,
  xstockstrat-trading, xstockstrat-ui.
- **No "Not found / create from scratch" steps** — every path/symbol cited a real `path:line`
  (new files — migrations, `useSignalAttribution.ts`, `attribution/page.tsx`, fixtures, tests — follow
  a grounded sibling pattern, not an absent-pattern gap).
