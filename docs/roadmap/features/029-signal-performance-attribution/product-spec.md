# Product Spec: signal-performance-attribution

**Created**: 2026-05-26

---

## Problem Statement

Signal source weights (feature 007) are currently set by manual intuition. The platform has no mechanism to measure whether a given source's signals actually produce profitable trades. Without attribution, a poorly performing source can silently drag down aggregate conviction scores indefinitely, and a high-performing source cannot be identified and up-weighted based on evidence.

## User Story

As a platform operator, I want to see per-source trading performance metrics (win rate, average return, total P&L) derived from real fills so that I can tune signal source weights with data instead of guesswork.

## Functional Requirements

FR-1. The **analysis** service must expose a new `GetAttribution` gRPC RPC that returns per-source attribution metrics for a given date range: source ID (the `signal_sources.slug`), source name, trade count, win count, win rate (%), average return per trade (%), total realized P&L. (There is **no** separate "insights" service — `/insights` is a segment of `xstockstrat-ui`, which renders this RPC's response; see FR-6.)
FR-2. The signal-attribution inputs for a trade are the **contributing signal source(s) and their conviction at order time**, which feature 042 (`042-order-snapshots-pnl-patterns`, **launched**) **already captures and persists** in `analysis.order_snapshots.signals` (repeated `{name, value, source}`, `value` = ingest conviction) per `order.*` event. 029 **reuses that captured data** — it does **not** add a producer-side attribution column to `trading.orders` and does **not** add a per-source weight vector to order submission. (`PlaceOrderRequest` carries no signal linkage and no causal analysis-score→order weight vector is persisted anywhere, so trading has nothing to stamp; building it would duplicate 042.) A closed position whose captured snapshots carry **no** signals is categorized as `manual` and excluded from per-source metrics.
FR-3. **V1 = winner-takes-all by highest input weight.** A trade is attributed **in full** to the source of the signal that had the highest captured conviction (`order_snapshots.signals[].value`) at order time (FR-2). The **only** fractional case in V1 is an **exact tie** on the top value: the trade is then split equally across the tied sources (a two-way tie is 0.5/0.5). Non-tied multi-signal fractional attribution is out of scope (V2) — see Out of Scope. (The relevant field is a cardinal conviction **value**, not `Opportunity.conviction`, which is an ordinal ranking — see Design Guardrails.)
FR-4. Win is defined as: realized P&L for the position **net of trading fees** > 0. **Per-fill fee capture is additive plumbing this feature introduces** (fills carry no fee field today; realized P&L is price-only/gross): a `fees` value rides the `order.filled`/`order.partially_filled` ledger event payload (a `google.protobuf.Struct` — an additive map key, **no proto change**), is accumulated by the portfolio realized-P&L fold into a new `portfolio.positions.fees_accum` column, and emitted on `portfolio.position.closed` as an additive `fees_total` key that the analysis 042 consumer persists to a new `analysis.pnl_positions.fees_total` column. `GetAttribution`'s win test computes net = `realized_pnl − fees_total`. The existing `realized_pnl` figure stays **gross** and authoritative (unchanged), so `GetPnL` and 042's pnl-patterns page are not regressed (C-10(b)/C-16). **Honest limitation:** Alpaca exposes no per-fill fee on the order/fill path (US equities are commission-free; SEC/TAF regulatory fees appear only as end-of-day-aggregated Account Activities rows), so the Alpaca-sourced `fees` value defaults to **0** until a named follow-up sources it from the Activities API — the seam is correct and net-of-fees end-to-end, and net == gross wherever fee data is absent. See the Open Risk in `design.md`.
FR-5. Metrics must be queryable by date range and filterable by source ID.
FR-6. Results are displayed as a sortable table in the insights UI with columns: source name, trades, win rate, avg return %, total P&L.
FR-7. A "copy to clipboard" button exports the table as CSV for use in weight adjustment decisions.

## Out of Scope

- Automatic weight adjustment based on attribution (V2 — human review required first)
- **Fractional attribution across _non-tied_ multi-signal inputs is V2; the exact-tie equal split (FR-3) is the only V1 fractional case.** Otherwise V1 is winner-takes-all by highest input weight.
- Real-time attribution (batch computation over closed positions only)

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-trading` — **fee-capture only** (FR-4): add `Fees` to the normalized `broker.BrokerOrder` and stamp an additive `fees` key on the `order.filled`/`order.partially_filled` ledger event payload. **No** producer-side attribution column and **no** order-submission weight vector (dropped — 042 already captures the signal inputs, FR-2).
- `xstockstrat-portfolio` — thread the per-fill `fees` through the realized-P&L fold: add a `fees_accum` column to `portfolio.positions` (migration `014`) and emit an additive `fees_total` key on `portfolio.position.closed` (FR-4). The existing `realized_pnl` key stays gross/authoritative.
- `xstockstrat-ingest` — queried (`ListSignalSources`) to resolve the source display name from the source slug; no change.
- `xstockstrat-ledger` — carries the additive `fees`/`fees_total` payload keys (event payloads are `google.protobuf.Struct`); **no schema change**.
- `xstockstrat-analysis` — new read-side `GetAttribution` RPC aggregating 042's `pnl_positions` + `order_snapshots.signals`; persist the additive `fees_total` on close and add a `fees_total` column to `analysis.pnl_positions` (migration `021`); win test is net of fees.
- `xstockstrat-ui` — new attribution panel in the `/insights` **segment** (a segment of `xstockstrat-ui`, not a separate service); P&L labelled "net of fees".

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights`: a new **signal-performance attribution panel** rendering the per-source metrics as a sortable table (source name, trades, win rate, avg return %, total P&L) with a date-range control, a `source_id` filter, and a "copy to clipboard" CSV export. Reachable through the existing `/insights` nav entry; if it introduces a new page/route, it must register into the shared nav (`PLATFORM_SUBNAV`) with a nav-reachability test (C-10(a)).
- [ ] **Agent** — not required for this feature.
- [ ] **None**

## Proto Contract Changes

- New RPC in analysis proto: `GetAttribution(GetAttributionRequest) returns (GetAttributionResponse)` — **additive** (new RPC + new messages only; no change to `Opportunity` or any existing message, so **no field-number collision** with features 095/110).
- `GetAttributionRequest`: `start`, `end` (`google.protobuf.Timestamp`), optional `source_id` filter (the `signal_sources.slug`).
- `GetAttributionResponse`: repeated `SourceAttribution` message — source ID (slug), source name, trade count, win count, win rate (%), average return per trade (%), total realized P&L (net of fees).
- **No trading order-submission proto change** — the producer-side weight vector is dropped; FR-2 reuses 042's already-captured `order_snapshots.signals`.
- **No proto change for fee capture** (FR-4): the `fees`/`fees_total` values ride the `order.filled`/`order.partially_filled`/`portfolio.position.closed` event payloads, which are `google.protobuf.Struct` (schemaless) — additive map keys, not proto fields.
- All additive — no field removals/renames/type changes. `buf breaking` stays green. Run `./scripts/buf-gen.sh`.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- **No `trading.orders` migration** — the producer-side attribution column is dropped (FR-2 reuses 042's capture). The prior "trading migration `010`" plan is withdrawn.
- [x] `xstockstrat-portfolio`: **migration `014`** — `ALTER TABLE portfolio.positions ADD COLUMN fees_accum NUMERIC NOT NULL DEFAULT 0` (parallel to `realized_accum`, migration `010`), so the realized-P&L fold accumulates per-fill fees across a position's window (FR-4). Next NNN after `013_positions_provenance`; paired `.down.sql` required (**C-07**).
- [x] `xstockstrat-analysis`: **migration `021`** — `ALTER TABLE analysis.pnl_positions ADD COLUMN fees_total NUMERIC NOT NULL DEFAULT 0` (persisted from the additive `portfolio.position.closed` `fees_total` payload key) **plus** an additive read index `CREATE INDEX ... ON analysis.pnl_positions (user_id, closed_at)` for the date-range `GetAttribution` query. Next NNN after `020_job_schedule`; paired `.down.sql` required (**C-07**).
- All three columns are additive/nullable-safe (`NOT NULL DEFAULT 0`), so existing rows read as fee-free (net == gross) with no backfill. `pnl_positions.realized_pnl` is unchanged (stays gross/authoritative). No cross-schema raw SQL join is introduced — attribution reads only analysis-owned tables (`pnl_positions`, `order_snapshots`) plus the existing ingest `ListSignalSources` gRPC edge.

## Feature Workflow Notes

Branch to create: `feature/signal-performance-attribution` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] Service owner approvals — analysis (new `GetAttribution` RPC + migration `021`), portfolio (migration `014` + fee fold), trading (fee stamp on the fill event)
- [x] Proto Reviewer (non-breaking proto change — additive RPC + messages only; `buf breaking` must pass)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, proto change is **non-breaking**
- [x] DBA review + service owner (schema migrations) — `portfolio.positions.fees_accum` (migration `014`) and `analysis.pnl_positions.fees_total` + `(user_id, closed_at)` index (migration `021`), each with paired `.down.sql`

## Trading Service Impact (C-3, C-5)

- **C-3 (paper/live mode):** the feature is **mode-agnostic / paper-testable** — trading's only change is stamping an additive `fees` key on an already-emitted fill event; it changes **no** order-execution path (no submit/cancel/replace logic touched), so it behaves identically in paper and live.
- **C-5 (partial vs. full fills):** attribution reads **position-level realized P&L**, so an order's partial-vs-full fill status does not affect the attribution result.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

None — resolved or moved below. (The fractional-attribution question is **resolved inline**: V1 = winner-takes-all by highest input weight, with an equal split only on an exact tie — see FR-3 and Out of Scope. The storage-model and feature-042 reconciliation questions are **Design-Phase Decisions** below.)

## Design-Phase Decisions (RESOLVED by /sdd-design + operator gate — see design.md)

- **Storage / composition model — RESOLVED.** No new attribution store and no cross-schema join.
  `GetAttribution` reads at query time over analysis-owned tables 042 already writes (`pnl_positions`,
  `order_snapshots.signals`) + the existing ingest `ListSignalSources` gRPC edge.
- **Reconcile with feature 042 — RESOLVED (reuse, distinct RPC).** 029 adds a **distinct read-side
  `GetAttribution` RPC** that **reuses** 042's captured `pnl_positions` + `order_snapshots.signals`
  rather than extending `QueryPnLPatterns` (different request/aggregation shape). The producer-side
  weight vector is dropped (operator decision #1).
- **Net-of-fees win definition — RESOLVED (operator decision #2).** Add additive per-fill `fees`
  plumbing (fill event → portfolio `fees_accum` fold → `portfolio.position.closed` `fees_total` →
  `analysis.pnl_positions.fees_total`); win test is net. Alpaca exposes no per-fill fee today, so the
  Alpaca value defaults to 0 pending an Activities-API follow-up (Open Risk in design.md).

## Design Guardrails (known traps — from the SDD Ledger, read before design)

- **Attribution lives on the order, not the position** (insight 2026-08-07, exit-cooldown): `portfolio.Position` carries no source/strategy attribution — the order that opened it does, because attribution is captured at order-placement time. This is exactly why 029 reuses feature 042's **per-`order.*`-event** `order_snapshots.signals` capture (FR-2) and does not try to fabricate attribution from a position.
- **Owner/tenancy scoping** (fail 2026-08-19, 131-live-strategy-opportunity-attribution): a global attribution query (`list_live_enabled`-style) cross-attributed another user's data (IDOR). Every new `GetAttribution` query (FR-1/FR-5) must be user-scoped, especially given feature 133 strategy ownership.
- **Ordinal conviction is not a cardinal weight** (fails 2026-08-05, mpt-portfolio-optimization / 023-position-sizing-engine): when picking the "highest-weighted signal input" (FR-3), read what the candidate score/weight field's doc-comment actually represents — `Opportunity.conviction` is an ordinal ranking, not a probability.
- **Enum-subset propagation for source resolution** (fail 2026-08-05, signal-source-registry): when resolving/filtering by signal source (FR-2/FR-5), cross-check every downstream artifact (migration CHECK, validators, tests) against the full source-type enum, including mediated subtypes.
- **Authoritative value parity across read paths** (fail 2026-07-01, 056-open-positions-ui → C-10(b)): realized P&L (FR-4) has an authoritative source; ensure the attribution figure agrees with the ledger/portfolio value it derives from, with a parity check.
