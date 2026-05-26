# Product Spec: ledger-event-export

**Created**: 2026-05-26

---

## Problem Statement

The ledger service stores all platform events (fills, signal ingestions, P&L snapshots, config changes) in an append-only TimescaleDB hypertable, but there is no self-service path to retrieve a structured export. Retrieving this data currently requires direct database access. This blocks tax reporting, manual strategy review, and audit requirements.

## User Story

As a trader, I want to download a structured export of all ledger events for a date range so that I can prepare tax filings, review which signals preceded my best trades, and satisfy any audit or compliance requirements.

## Functional Requirements

FR-1. The ledger service must expose a `GET /export` HTTP endpoint (on its existing HTTP port 8057) that accepts `start`, `end` (ISO 8601 date strings), and optional `event_type` query parameters.
FR-2. The endpoint must stream the response as newline-delimited JSON (NDJSON) by default; a `format=csv` query parameter selects CSV with a header row.
FR-3. Supported `event_type` filter values (comma-separated): `fill`, `signal`, `pnl_snapshot`, `config_change`, `alert` — empty means all types.
FR-4. The export window must be bounded by a configurable maximum duration (`ledger.export.max_window_days`, default 365) to prevent runaway queries.
FR-5. The endpoint must require a valid JWT (forwarded `x-user-id` header from nginx) — unauthenticated requests receive 401.
FR-6. Response must stream rows as they are read from the DB — do not buffer the full result set in memory.
FR-7. Each exported row must include: `event_id`, `event_type`, `occurred_at`, `service_origin`, `payload` (JSON object), `user_id`.
FR-8. A download button in the trader or insights UI triggers the export with sensible defaults (last 90 days, all types).

## Out of Scope

- Export scheduling or email delivery of export files
- PDF or Excel formats
- Aggregated/summarized views (pivot tables, P&L summaries) — those belong in the insights UI
- Write operations via the export endpoint — read-only

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ledger` — new HTTP export handler, streaming DB cursor
- `xstockstrat-trader` or `xstockstrat-insights` — download button in UI (one of these, TBD at impl-spec time)

## Proto Contract Changes

- [ ] No proto changes required (HTTP endpoint only, not a gRPC RPC)

## Config Key Changes

- `ledger.export.max_window_days` — integer; maximum allowed export date range (default: 365)
- `ledger.export.enabled` — boolean feature flag (default: true)

## Database Changes

- [ ] No schema changes (reads from existing ledger events hypertable)
- Note: ensure a composite index on `(event_type, occurred_at)` exists — verify at impl-spec time

## Feature Workflow Notes

Branch to create: `feature/ledger-event-export` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking HTTP addition, no proto changes)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable (read-only; index check TBD)

## Acceptance Criteria

1. `GET /export?start=2026-01-01&end=2026-03-31` returns a streaming NDJSON response with all events in that window.
2. `GET /export?start=2026-01-01&end=2026-03-31&format=csv` returns a valid CSV with a header row and one row per event.
3. `GET /export?event_type=fill,signal` filters to only fill and signal events.
4. A request spanning more than `max_window_days` returns 400 with a descriptive error.
5. An unauthenticated request returns 401.
6. A 1-million-row export does not exhaust Node.js heap — streaming cursor confirmed via load test.
7. The UI download button initiates the export and prompts a file-save dialog.

## Open Questions

- [ ] Should the export endpoint live on the ledger HTTP port (8057) directly, or be proxied through nginx (preferred for auth header stripping)? Nginx proxy is the safer pattern — confirm at impl-spec time.
- [ ] Which UI (trader vs. insights) hosts the download button? Insights is more natural for review; trader makes sense for fill-centric export. Decision deferred to impl-spec.
