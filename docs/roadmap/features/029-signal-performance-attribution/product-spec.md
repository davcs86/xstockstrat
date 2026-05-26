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
- `xstockstrat-insights` — new attribution panel in UI

## Proto Contract Changes

- New RPC in analysis proto: `GetAttribution(GetAttributionRequest) returns (GetAttributionResponse)`
- `GetAttributionRequest`: `start`, `end` (Timestamp), optional `source_id` filter
- `GetAttributionResponse`: repeated `SourceAttribution` message with fields above
- `signal_id` field added to order submission request in trading proto (non-breaking addition)

## Config Key Changes

- [ ] No new config keys

## Database Changes

- Trading service: add `signal_id` column to orders table (nullable; non-breaking migration)
- Attribution query joins: `orders.signal_id → ingest.signals.id → ingest.signal_sources.id`
- Composite index on `orders(signal_id, status, closed_at)` for efficient attribution queries

## Feature Workflow Notes

Branch to create: `feature/signal-performance-attribution` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto addition, additive migration)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [x] DBA review + service owner (schema migration) — `signal_id` column addition to orders table

## Acceptance Criteria

1. After 20+ closed paper trades with signal attribution, the insights UI displays a per-source table with correct win rates and P&L totals verified against ledger records.
2. Orders submitted without a `signal_id` are excluded from per-source metrics and counted separately as `manual`.
3. Filtering by `source_id` returns only trades attributed to that source.
4. CSV export produces a valid file with all displayed columns.
5. Adding a new signal source requires no code change — it appears automatically once trades are attributed to it.

## Open Questions

- [ ] Should attribution be stored as a derived table (materialized at query time) or as a pre-computed event written to the ledger at position close? Pre-computed is faster but adds a write path; query-time is simpler but slower for large trade histories. Decision deferred to impl-spec.
- [ ] Fractional attribution when multiple sources contributed: defer to V2 (winner-takes-all by highest weight in V1) or implement in V1? Deferred to impl-spec.
