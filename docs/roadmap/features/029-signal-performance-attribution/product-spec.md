# Product Spec: signal-performance-attribution

**Created**: 2026-05-26

---

## Problem Statement

Signal source weights (feature 007) are currently set by manual intuition. The platform has no mechanism to measure whether a given source's signals actually produce profitable trades. Without attribution, a poorly performing source can silently drag down aggregate conviction scores indefinitely, and a high-performing source cannot be identified and up-weighted based on evidence.

## User Story

As a platform operator, I want to see per-source trading performance metrics (win rate, average return, total P&L) derived from real fills so that I can tune signal source weights with data instead of guesswork.

## Functional Requirements

FR-1. The analysis service must expose a new RPC (or the insights service a new HTTP endpoint) that returns per-source attribution metrics for a given date range: source ID, source name, trade count, win count, win rate (%), average return per trade (%), total realized P&L.
FR-2. Attribution links a fill event (from the ledger) to a signal (from the ingest service) via a `signal_id` reference stored on the trading order at submission time. If no `signal_id` is present on an order, the fill is categorized as `manual` and excluded from per-source metrics.
FR-3. A trade is attributed to the source of the signal that was the highest-weighted input to the analysis score at order submission time. In case of a tie, attribution is split equally (fractional attribution).
FR-4. Win is defined as: realized P&L for the position > 0 after accounting for trading fees. Fees are sourced from the fill event payload.
FR-5. Metrics must be queryable by date range and filterable by source ID.
FR-6. Results are displayed as a sortable table in the insights UI with columns: source name, trades, win rate, avg return %, total P&L.
FR-7. A "copy to clipboard" button exports the table as CSV for use in weight adjustment decisions.

## Out of Scope

- Automatic weight adjustment based on attribution (V2 — human review required first)
- Attribution across multiple concurrent signals (fractional multi-signal attribution beyond the primary source is V2)
- Real-time attribution (batch computation over closed positions only)

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-trading` — must attach `signal_id` to order records at submission time
- `xstockstrat-ledger` — queried for fill events; no schema change if `signal_id` is stored in fill payload
- `xstockstrat-ingest` — queried to resolve source name from signal ID
- `xstockstrat-analysis` — new `GetAttribution` RPC or query logic
- `xstockstrat-ui` — new attribution panel in the `/insights` segment

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights`: a new **signal-performance attribution panel** rendering the per-source metrics as a sortable table (source name, trades, win rate, avg return %, total P&L) with a date-range control, a `source_id` filter, and a "copy to clipboard" CSV export. Reachable through the existing `/insights` nav entry; if it introduces a new page/route, it must register into the shared nav (`PLATFORM_SUBNAV`) with a nav-reachability test (C-10(a)).
- [ ] **Agent** — not required for this feature.
- [ ] **None**

## Proto Contract Changes

- New RPC in analysis proto: `GetAttribution(GetAttributionRequest) returns (GetAttributionResponse)`.
- `GetAttributionRequest`: `start`, `end` (`google.protobuf.Timestamp`), optional `source_id` filter.
- `GetAttributionResponse`: repeated `SourceAttribution` message with fields — source ID, source name, trade count, win count, win rate (%), average return per trade (%), total realized P&L.
- `signal_id` field added to the order-submission request in the trading proto (additive → non-breaking; `buf breaking` stays green).
- All additive — no field removals/renames/type changes. Run `./scripts/buf-gen.sh`.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [x] `xstockstrat-trading`: add nullable `signal_id` column to the `orders` table (additive → non-breaking migration; existing rows are `NULL` and count as `manual`).
- [x] Composite index on `orders(signal_id, status, closed_at)` for efficient attribution queries.
- Attribution query joins: `orders.signal_id → ingest.signals.id → ingest.signal_sources.id`.
- Migration `NNN` prefix confirmed at `/sdd-spec` time by `ls services/xstockstrat-trading/migrations/`.

## Feature Workflow Notes

Branch to create: `feature/signal-performance-attribution` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto addition, additive migration)
- [x] Proto Reviewer (non-breaking proto change — additive RPC + field; `buf breaking` must pass)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, proto change is **non-breaking**
- [x] DBA review + service owner (schema migration) — nullable `signal_id` column + composite index on the `orders` table

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Should attribution be stored as a derived table (materialized at query time) or as a pre-computed event written to the ledger at position close? Pre-computed is faster but adds a write path; query-time is simpler but slower for large trade histories. Decision deferred to impl-spec.
- [ ] Fractional attribution when multiple sources contributed: defer to V2 (winner-takes-all by highest weight in V1) or implement in V1? Deferred to impl-spec.

### Known traps (from the SDD Ledger — read before design)

- **Attribution lives on the order, not the position** (insight 2026-08-07, exit-cooldown): `portfolio.Position` carries no source/strategy attribution — the order that opened it does, because attribution is captured at order-placement time. This validates storing `signal_id` on the order (FR-2); do not try to fabricate attribution from a position.
- **Owner/tenancy scoping** (fail 2026-08-19, 131-live-strategy-opportunity-attribution): a global attribution query (`list_live_enabled`-style) cross-attributed another user's data (IDOR). Every new `GetAttribution` query (FR-1/FR-5) must be user-scoped, especially given feature 133 strategy ownership.
- **Ordinal conviction is not a cardinal weight** (fails 2026-08-05, mpt-portfolio-optimization / 023-position-sizing-engine): when picking the "highest-weighted signal input" (FR-3), read what the candidate score/weight field's doc-comment actually represents — `Opportunity.conviction` is an ordinal ranking, not a probability.
- **Enum-subset propagation for source resolution** (fail 2026-08-05, signal-source-registry): when resolving/filtering by signal source (FR-2/FR-5), cross-check every downstream artifact (migration CHECK, validators, tests) against the full source-type enum, including mediated subtypes.
- **Authoritative value parity across read paths** (fail 2026-07-01, 056-open-positions-ui → C-10(b)): realized P&L (FR-4) has an authoritative source; ensure the attribution figure agrees with the ledger/portfolio value it derives from, with a parity check.
