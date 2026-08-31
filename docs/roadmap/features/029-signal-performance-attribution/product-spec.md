# Product Spec: signal-performance-attribution

**Created**: 2026-05-26

---

## Problem Statement

Signal source weights (feature 007) are currently set by manual intuition. The platform has no mechanism to measure whether a given source's signals actually produce profitable trades. Without attribution, a poorly performing source can silently drag down aggregate conviction scores indefinitely, and a high-performing source cannot be identified and up-weighted based on evidence.

## User Story

As a platform operator, I want to see per-source trading performance metrics (win rate, average return, total P&L) derived from real fills so that I can tune signal source weights with data instead of guesswork.

## Functional Requirements

FR-1. The **analysis** service must expose a new `GetAttribution` gRPC RPC that returns per-source attribution metrics for a given date range: source ID (the `signal_sources.slug`), source name, trade count, win count, win rate (%), average return per trade (%), total realized P&L. (There is **no** separate "insights" service — `/insights` is a segment of `xstockstrat-ui`, which renders this RPC's response; see FR-6.)
FR-2. At order submission time, the trading service persists the **signal-attribution inputs** for the order: the contributing signal source(s) **and their per-source input-weight vector** — not a lone scalar `signal_id`, which cannot represent the multi-source weights FR-3 needs. Feature 042 (`042-order-snapshots-pnl-patterns`, launched) already ships an attribution shape for exactly this — `OrderSnapshot` carrying a repeated `SignalEntry { name, value, source }` in `analysis.proto` — so 029 **reuses** that shape rather than inventing a parallel one (DRY); the storage location (029's own order-attribution column vs. 042's snapshot-capture path) is a Design-Phase Decision below. If an order carries **no** signal-attribution inputs, its fill is categorized as `manual` and excluded from per-source metrics.
FR-3. **V1 = winner-takes-all by highest input weight.** A trade is attributed **in full** to the source of the signal that was the highest-weighted input to the analysis score at order submission time (read from the persisted per-source weight vector, FR-2). The **only** fractional case in V1 is an **exact tie** on the top weight: the trade is then split equally across the tied sources (a two-way tie is 0.5/0.5). Non-tied multi-signal fractional attribution is out of scope (V2) — see Out of Scope. (The relevant field is a cardinal **input weight**, not `Opportunity.conviction`, which is an ordinal ranking — see Design Guardrails.)
FR-4. Win is defined as: realized P&L for the position > 0 after accounting for trading fees. Fees are sourced from the fill event payload.
FR-5. Metrics must be queryable by date range and filterable by source ID.
FR-6. Results are displayed as a sortable table in the insights UI with columns: source name, trades, win rate, avg return %, total P&L.
FR-7. A "copy to clipboard" button exports the table as CSV for use in weight adjustment decisions.

## Out of Scope

- Automatic weight adjustment based on attribution (V2 — human review required first)
- **Fractional attribution across _non-tied_ multi-signal inputs is V2; the exact-tie equal split (FR-3) is the only V1 fractional case.** Otherwise V1 is winner-takes-all by highest input weight.
- Real-time attribution (batch computation over closed positions only)

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-trading` — must persist the signal-attribution inputs (contributing source(s) + per-source weight vector) on order records at submission time (FR-2), reusing feature 042's `SignalEntry`/`OrderSnapshot` shape
- `xstockstrat-ledger` — queried for fill events (fees + realized-P&L inputs, FR-4); no schema change
- `xstockstrat-ingest` — queried (`QuerySignals`) to resolve the source display name from the source slug
- `xstockstrat-analysis` — new `GetAttribution` RPC (reconciled with feature 042's `QueryPnLPatterns`/`OrderSnapshot` surface — Design-Phase Decision)
- `xstockstrat-ui` — new attribution panel in the `/insights` **segment** (a segment of `xstockstrat-ui`, not a separate service)

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights`: a new **signal-performance attribution panel** rendering the per-source metrics as a sortable table (source name, trades, win rate, avg return %, total P&L) with a date-range control, a `source_id` filter, and a "copy to clipboard" CSV export. Reachable through the existing `/insights` nav entry; if it introduces a new page/route, it must register into the shared nav (`PLATFORM_SUBNAV`) with a nav-reachability test (C-10(a)).
- [ ] **Agent** — not required for this feature.
- [ ] **None**

## Proto Contract Changes

- New RPC in analysis proto: `GetAttribution(GetAttributionRequest) returns (GetAttributionResponse)` — **additive** (new RPC + new messages only; no change to `Opportunity` or any existing message, so **no field-number collision** with features 095/110).
- `GetAttributionRequest`: `start`, `end` (`google.protobuf.Timestamp`), optional `source_id` filter (the `signal_sources.slug`).
- `GetAttributionResponse`: repeated `SourceAttribution` message — source ID (slug), source name, trade count, win count, win rate (%), average return per trade (%), total realized P&L.
- Trading order-submission request gains **additive** signal-attribution inputs (contributing source(s) + per-source weight vector), **reusing feature 042's `SignalEntry { name, value, source }` shape** rather than a new scalar `signal_id` field (a lone `signal_id` cannot carry the weight vector FR-3 needs). Additive → `buf breaking` stays green.
- Whether 029 adds its own `GetAttribution` surface or extends/composes 042's `QueryPnLPatterns`/`OrderSnapshot` is a Design-Phase Decision below.
- All additive — no field removals/renames/type changes. Run `./scripts/buf-gen.sh`.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [x] `xstockstrat-trading`: add **nullable** signal-attribution column(s) to `trading.orders` — the contributing source(s) + per-source weight vector (FR-2), modeled on feature 042's `SignalEntry`/`OrderSnapshot` shape (e.g. a JSONB column), **not** a lone scalar `signal_id` (additive → non-breaking migration; existing rows are `NULL` and count as `manual`). The new migration **continues the `NNN` sequence from the last file in `services/xstockstrat-trading/migrations/`** — currently `009_offline_position_baselines`, so the next is `010`. A paired `010_*.down.sql` is **required** (Constitution **C-07**).
- [x] Index over **existing** columns only. `trading.orders` has **no `closed_at` column** — the phantom `orders(signal_id, status, closed_at)` index is removed. Attribution is over closed *positions*; realized P&L is position-level. A candidate index is `orders(user_id, signal_id, status)` plus the real fill timestamp `filled_at` (added by migration `008`); the **exact index is resolved at `/sdd-spec`** against the real schema.
- **Storage/composition model is a Design-Phase Decision** (see below). The three-way raw SQL join across the `trading` and `ingest` schemas is **not permitted** (per-service schema ownership + gRPC-only). Note the real schema names: `ingest.signals` **is not a table** — signals live in `ingest.newsletter_signals`; `ingest.signal_sources` has **no `id` column** (its PK is `slug TEXT`, and the join is `newsletter_signals.source = signal_sources.slug`). Attribution therefore composes either via gRPC edges (analysis calls trading `ListOrders` + ingest `QuerySignals`) or via a derived/materialized table owned by a single service.

## Feature Workflow Notes

Branch to create: `feature/signal-performance-attribution` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto addition, additive migration)
- [x] Proto Reviewer (non-breaking proto change — additive RPC + field; `buf breaking` must pass)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, proto change is **non-breaking**
- [x] DBA review + service owner (schema migration) — nullable signal-attribution column(s) on `trading.orders` (migration `010`, with paired `.down.sql`) + an index over existing columns

## Trading Service Impact (C-3, C-5)

- **C-3 (paper/live mode):** the feature is **mode-agnostic / paper-testable** — it records attribution inputs and reads them back; it changes **no** order-execution path, so it behaves identically in paper and live.
- **C-5 (partial vs. full fills):** attribution reads **position-level realized P&L**, so an order's partial-vs-full fill status does not affect the attribution result.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

None — resolved or moved below. (The fractional-attribution question is **resolved inline**: V1 = winner-takes-all by highest input weight, with an equal split only on an exact tie — see FR-3 and Out of Scope. The storage-model and feature-042 reconciliation questions are **Design-Phase Decisions** below.)

## Design-Phase Decisions (owned by /sdd-design)

- **Storage / composition model.** Store attribution as a derived table (materialized at query time) or as a pre-computed event written to the ledger at position close? Pre-computed is faster but adds a write path; query-time is simpler but slower for large trade histories. **Constraint:** the three-way raw SQL join across the `trading` and `ingest` schemas is **not permitted** (per-service schema ownership + gRPC-only) — attribution composes either via gRPC edges (analysis calls trading `ListOrders` + ingest `QuerySignals`) or via a derived/materialized table owned by a single service.
- **Reconcile 029's `GetAttribution` with feature 042's existing attribution surface.** Feature `042-order-snapshots-pnl-patterns` (launched) already ships `QueryPnLPatterns`, `FactorType.FACTOR_TYPE_SIGNAL`, `SignalEntry { name, value, source }`, and `OrderSnapshot` in `analysis.proto`. Decide **reuse vs. new**: does 029 add a distinct `GetAttribution` RPC, or extend/compose 042's `QueryPnLPatterns`/`OrderSnapshot` capture path? Either way, **reuse 042's `SignalEntry`/`OrderSnapshot` shape** for the persisted per-source weight vector (FR-2) rather than inventing a parallel one (DRY).

## Design Guardrails (known traps — from the SDD Ledger, read before design)

- **Attribution lives on the order, not the position** (insight 2026-08-07, exit-cooldown): `portfolio.Position` carries no source/strategy attribution — the order that opened it does, because attribution is captured at order-placement time. This validates persisting the signal-attribution inputs on the order (FR-2); do not try to fabricate attribution from a position.
- **Owner/tenancy scoping** (fail 2026-08-19, 131-live-strategy-opportunity-attribution): a global attribution query (`list_live_enabled`-style) cross-attributed another user's data (IDOR). Every new `GetAttribution` query (FR-1/FR-5) must be user-scoped, especially given feature 133 strategy ownership.
- **Ordinal conviction is not a cardinal weight** (fails 2026-08-05, mpt-portfolio-optimization / 023-position-sizing-engine): when picking the "highest-weighted signal input" (FR-3), read what the candidate score/weight field's doc-comment actually represents — `Opportunity.conviction` is an ordinal ranking, not a probability.
- **Enum-subset propagation for source resolution** (fail 2026-08-05, signal-source-registry): when resolving/filtering by signal source (FR-2/FR-5), cross-check every downstream artifact (migration CHECK, validators, tests) against the full source-type enum, including mediated subtypes.
- **Authoritative value parity across read paths** (fail 2026-07-01, 056-open-positions-ui → C-10(b)): realized P&L (FR-4) has an authoritative source; ensure the attribution figure agrees with the ledger/portfolio value it derives from, with a parity check.
