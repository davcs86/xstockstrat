# Design: signal-performance-attribution

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: open-risk-accepted, pending operator confirmation of the marked decisions)
**Approved by**: provisional — self-run proposer/adversary debate inside an isolated subagent
(no `AskUserQuestion` available; per fails.md 2026-08-08 (121/122/123), the design forks below are
surfaced to the operator for a live gate rather than treated as final).
**Grounded in**: recon.md

---

## Chosen Approach

**029 collapses into a new, additive, read-side `GetAttribution` RPC in `xstockstrat-analysis` that
aggregates feature 042's already-persisted capture. No trading migration, no order-submission proto
change, no cross-schema SQL join.**

The product spec's producer-side plan (stamp a per-source weight vector on `trading.orders` at
`PlaceOrder`, then have analysis recompose attribution via `ListOrders` + `QuerySignals`) is
**superseded** because feature 042 already persists, in analysis-owned tables, exactly the inputs
029 needs:

- **Which positions closed, when, for whom, and their realized P&L** → `analysis.pnl_positions`
  (`user_id`, `symbol`, `closed_at`, `realized_pnl`), sealed by the 042 consumer on
  `portfolio.position.closed` (recon: `pnl_positions.py:46-76`).
- **The contributing signal sources + their conviction at order time** →
  `analysis.order_snapshots.signals` JSONB `[{name,value,source}]`, captured per `order.*` event
  (recon: `pnl_pattern_consumer.py:206-223`). This is the reuse of 042's `SignalEntry`/`OrderSnapshot`
  shape the product spec's DRY directive asked for.

**Handler (`AnalysisServicer.GetAttribution`)** — read-only, mirroring `QueryPnLPatterns`
(`servicer.py:2817`):
1. Resolve the caller from the **`x-user-id` header** via `_caller_user_id` (feature 133; never the
   request body — anti-IDOR, fails.md 131).
2. Query `analysis.pnl_positions` for the caller's sealed positions with `closed_at ∈ [start, end]`
   (optional additive index, migration `021`).
3. For each sealed position, read its `order_snapshots.signals`. **Winner-takes-all (FR-3):** attribute
   the whole trade to the source whose signal has the highest `value` (conviction) across the
   position's snapshots; an **exact tie on the top value** splits equally across the tied sources
   (two-way → 0.5/0.5). A position whose snapshots carry **no** signals is **`manual`** and excluded
   from per-source metrics (FR-2/AC-3).
4. Aggregate per `source_id` (the slug): `trade_count`, `win_count` (realized P&L > 0),
   `win_rate = win_count/trade_count`, `avg_return`, `total_pnl`. Resolve `source_id → source_name`
   via ingest **`ListSignalSources`** over the existing `INGEST_ENDPOINT` stub (no new edge — F-06;
   AC-9 auto-appearance because the source comes from the snapshot slug, no enum).
5. Optional `source_id` request filter (FR-5).

**Proto (additive):** append `GetAttribution` to `AnalysisService` (after `analysis.proto:49`) +
`GetAttributionRequest{start, end, source_id?}`, `SourceAttribution{source_id, source_name,
trade_count, win_count, win_rate, avg_return, total_pnl}`, `GetAttributionResponse{repeated
SourceAttribution}` (after `:746`). **`Opportunity` (`:542`) is untouched → confirmed no field-number
collision with features 095/110.** `buf breaking` stays green (C-09).

**Consumer surface (C-14):** a **new `/insights/attribution` page** — a sortable `DataTable`
(`ui/data-table.tsx`), a date-range control, a `source_id` filter, and a copy-to-clipboard CSV export
(FR-6/FR-7). Registered in `PLATFORM_SUBNAV` (`PlatformHeader.tsx:72`) with a **nav-reachability test**
(C-10(a); the 060/058 fail). BFF via the existing `[...connect]` route + `insightsBff.ts` + a
`useSignalAttribution` hook modeled on `usePnLPatterns.ts`. Design-role tokens + canonical state
primitives only (C-17). New `SourceAttribution` e2e fixture + `INVENTORY.md` row (C-12/C-13).

**DB:** at most one **additive** analysis migration `021` (index `pnl_positions(user_id, closed_at)` +
paired `.down.sql`, C-07). This **replaces** the product spec's `trading.orders` migration `010`,
which is dropped.

### Decisions requiring operator confirmation (surfaced, not silently taken — P-03)

1. **Drop the producer-side scope.** FR-2's "trading persists attribution inputs at submission" is
   realized by **reusing 042's ledger-driven capture in analysis**, not by a `trading.orders`
   attribution column or a `PlaceOrder` weight vector. Justification: `PlaceOrderRequest` carries no
   signal linkage (`trading.proto:96`) and no causal analysis-score→order weight vector is persisted
   anywhere, so trading has nothing to stamp; building it would duplicate 042 (DRY) and widen scope
   into trading + the proto. **This is a scope reduction; confirm the FR-2 realization change.**
2. **"Highest input weight" = highest ingest conviction at order time.** `SignalEntry.value` is the
   ingest conviction (cardinal — correct per the 023 guardrail — but the signal's own confidence, not
   a feature-007 source-reliability-weighted score input). It is the best available proxy given (1).
   **Confirm this realization of FR-3.**
3. **AC-6 net-of-fees — blocking data gap.** No realized-P&L figure in the platform subtracts fees
   (the shared `pnl.RealizedDelta` fold is price-only), and `order.filled` carries no fee field.
   Options: **(A)** redefine AC-6 to "win = authoritative (gross) realized P&L > 0" (a C-16 CHANGE +
   sign-off), same fidelity 042's pnl-patterns page already ships; **(B)** add fee-capture plumbing
   (trading fill emit → ledger → snapshot) + query-time netting — significant scope expansion touching
   trading, the ledger fill contract, and 042's PRESERVE'd consumer. **Recommend (A) for V1.**

## Rejected Alternatives

- **Product-spec-literal producer-side (trading migration 010 + `PlaceOrder` weight vector + analysis
  → trading `ListOrders` + analysis → ingest `QuerySignals` recomposition)** — rejected: duplicates
  042's already-persisted `order_snapshots`/`pnl_positions` (DRY); trading has no causal weight vector
  to stamp (`PlaceOrderRequest` has no signal field, no score→order path); adds two runtime gRPC edges
  to re-derive what 042's consumer already wrote once.
- **Aggregate over `pnl_pattern_samples`** — rejected: `_build_samples` stores only
  `signal_present=true`, dropping the conviction value (`pnl_pattern_consumer.py:337-352`), so it
  cannot pick the highest-weighted source and it fans a position out to every factor (double-counting
  across sources). Read `order_snapshots.signals` instead.
- **A new pre-computed attribution event/table at position close** — rejected: 042 already writes at
  seal; a query-time read matches 042's "bucket at query time" precedent (`servicer.py:2817`) and
  avoids a third write path for a batch/offline read.
- **Extend `QueryPnLPatterns` instead of a new RPC** — rejected: it is symbol-scoped and returns ranked
  indicator/signal *factors* (correlation), not date-range per-source partitioned win/loss; different
  request shape and aggregation. A separate additive RPC is clearer and collision-free.
- **Recompute realized P&L in analysis for user-facing accuracy** — rejected: a second realized-P&L
  formula is the exact 056 / C-10(b) fail. Reuse the authoritative figure; if fee-netting is adopted
  (option B), document the deliberate net-vs-gross difference rather than diverging silently.

## Open Risks

- [ ] **AC-6 fee data gap** — resolve the option A/B decision before /sdd-spec; if A, record the C-16
  CHANGE + operator sign-off in context.md. → design decision / /sdd-spec step 5.
- [ ] **`avg return %` denominator** — derive cost basis from the opening snapshot price×qty
  (approximate) or express as avg P&L $; pin at /sdd-spec. → analysis step.
- [ ] **042 synthesized-`position_id` window sharing** (multi-cycle same identity) and short/sync
  `realized_accum` inexactness — inherited v1 limitation (no worse than 042's shipped page); accept and
  name in the UI/docs. → analysis step + acceptance note.
- [ ] **C-10(b) parity** — add a parity check that GetAttribution's per-source total reconciles with
  the underlying `pnl_positions.realized_pnl` sums (AC-1 "reconcile against the underlying ledger
  records"). → test step.
- [ ] **Overlap re-scan at /sdd-spec** — confirm analysis migration `021` and the new RPC name are
  still free against all remote branches (fails.md 081 numbering trap). → /sdd-spec.

## Constitution Rules Touched

- `C-01` — honored: every claim cites a `path:line` in recon.md; the fee/weight absences are grep-established, not assumed.
- `C-04` — honored: `source_id` stays a **string** (open source registry, base/derived/mediated; AC-9 auto-appearance) — correct per governance (values are runtime-extensible, not a closed set).
- `C-07` — honored: any analysis migration is `021_*.up.sql` + paired `.down.sql`.
- `C-09` — honored: additive proto goes through `buf lint` + `buf breaking` + `./scripts/buf-gen.sh`.
- `C-10(a)` — honored: new `/insights/attribution` page registered in `PLATFORM_SUBNAV` with a nav-reachability test.
- `C-10(b)` — honored: no second realized-P&L formula; reuse the authoritative `pnl_positions.realized_pnl` (same source 042 ships) + a parity check; the fees decision is surfaced, not silently divergent.
- `C-12`/`C-13` — honored: UI tests use `e2e/fixtures/` + a new `SourceAttribution` fixture + `INVENTORY.md` row.
- `C-14` — honored: the `/insights` attribution panel is the named consumer surface and earns its own step(s).
- `C-16` — honored: 042's `order-snapshots-pnl-patterns.feature` and the platform realized-P&L purge rule are PRESERVE (029 is read-only over them); any AC-6 redefinition is a recorded CHANGE with sign-off.
- `C-17` — honored: design-role tokens, `DataTable`/canonical primitives, accessible names on controls.
- `P-03` — honored: the producer-side-drop, conviction-as-weight, and fee-gap deviations are escalated to the operator, never guessed.
- `F-06` — honored: no new pool and no new inter-service edge (reuse the analysis asyncpg pool + existing `INGEST_ENDPOINT` stub).
- No Floor (`F-*`) breach — C-10(b) is a Commandment, not a Floor; no F-11 halt.

## Business Rules Touched (C-16)

- PRESERVE `@AC-*` "Order snapshots and P&L pattern attribution" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — not regressed by: 029 adds a read-only RPC + additive read repo methods; it does not touch the consumer's capture/seal path or `QueryPnLPatterns`.
- PRESERVE "Deregistering an offline account purges its positions and realized P&L" (`docs/sdd/business-rules/platform.feature`) — not regressed by: 029 reads `pnl_positions` as-is; purged positions simply do not appear.
- CHANGE (conditional) `@AC-6` "Win is defined as realized P&L greater than 0 after fees" (this feature's own `acceptance.feature`) — only if operator picks option A (gross authoritative figure); carries the sign-off recorded in context.md. Net-new otherwise.
