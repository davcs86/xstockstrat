# Product Spec: ledger-event-export

**Created**: 2026-05-26

---

## Problem Statement

The ledger service stores all platform events (fills, signal ingestions, P&L snapshots, config changes) in an append-only TimescaleDB hypertable, but there is no self-service path to retrieve a structured export. Retrieving this data currently requires direct database access. This blocks tax reporting, manual strategy review, and audit requirements.

## User Story

As a trader, I want to download a structured export of all ledger events for a date range, so that I can prepare tax filings, review which signals preceded my best trades, and satisfy any audit or compliance requirements.

## Functional Requirements

FR-1. The ledger service (`xstockstrat-ledger`, gRPC-only on port 50057) must expose a **server-streaming gRPC RPC** `ExportEvents(ExportEventsRequest) returns (stream ExportEventsResponse)`. `ExportEventsRequest` carries the date range (`start`, `end` as ISO 8601 / `google.protobuf.Timestamp`) and an optional `event_type` filter. An `xstockstrat-ui` **BFF route** (`.../api/ledger/export`, exact segment decided at design — see § Design-Phase Decisions) authenticates the browser request, forwards the identity headers, calls `ExportEvents`, and re-exposes the stream to the browser over HTTP. Browsers never talk to the ledger directly. (There is no ledger HTTP port — the former `8057` HTTP/Connect-RPC server was removed; nginx was removed by feature 045.)
FR-2. The BFF route must stream the HTTP response as newline-delimited JSON (NDJSON, `application/x-ndjson`) by default; a `format=csv` query parameter selects CSV (`text/csv`) with a header row. NDJSON/CSV serialization happens in the BFF from the streamed `ExportEventsResponse` rows.
FR-3. Supported `event_type` filter values (comma-separated): `fill`, `signal`, `pnl_snapshot`, `config_change`, `alert` — empty means all types.
FR-4. The export window must be bounded by a configurable maximum duration (`ledger.export.max_window_days`, default 365) to prevent runaway queries. The ledger enforces the bound and returns a gRPC `InvalidArgument`; the BFF maps it to HTTP 400.
FR-5. The BFF route must require an authenticated session. The `xstockstrat-ui` middleware verifies the JWT and injects `x-user-id` / `x-access-scope` / `x-trace-id`, which the BFF forwards to the ledger on the `ExportEvents` call. An unauthenticated request is rejected with 401 (or redirected to the login route) and never reaches the ledger.
FR-6. Rows must stream end-to-end without buffering the full result set: the ledger reads rows from a DB cursor and emits them on the `ExportEvents` stream, and the BFF pipes each message straight to the HTTP response.
FR-7. Each exported row must include: `event_id`, `event_type`, `occurred_at`, `service_origin`, `payload` (JSON object), `user_id`.
FR-8. A download button in the `xstockstrat-ui` (segment decided at design — see § Design-Phase Decisions) triggers the export with sensible defaults (last 90 days, all types) via the BFF route and prompts a file-save dialog.
FR-9. The export must be gated by the `ledger.export.enabled` feature flag (default `true`). When `false`, the ledger rejects `ExportEvents` and the BFF returns an error (HTTP 403) without streaming any events.

## Out of Scope

- Export scheduling or email delivery of export files
- PDF or Excel formats
- Aggregated/summarized views (pivot tables, P&L summaries) — those belong in the insights UI
- Write operations via the export path — read-only

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ledger` — new `ExportEvents` server-streaming gRPC RPC, streaming DB cursor read
- `xstockstrat-ui` — new BFF route (`.../api/ledger/export`) that authenticates, forwards identity headers, calls `ExportEvents`, and re-exposes NDJSON (default) / CSV over HTTP, plus the "Export events" download button (exact `/trader` vs `/insights` segment decided at design)
- `packages/proto` — new server-streaming RPC + request/response messages in `ledger/v1/ledger.proto`

## Consumer Surface(s)

_Constitution **C-14**._ This feature adds a user-facing download control plus a new ledger export RPC re-exposed through the UI BFF.
- [x] **UI** — `xstockstrat-ui`: a new "Export events" download button, defaulting to last 90 days / all event types, that triggers the export and prompts a file-save dialog. The exact segment (`/trader` vs `/insights`) that hosts the control is a **Design-Phase Decision** owned by `/sdd-design` (see § Design-Phase Decisions) — it is decided at design, not left open-ended.
- [ ] **Agent** — `xstockstrat-agent` MCP tool(s): none.
- [ ] **None** — internal/platform-only; state why.

## Proto Contract Changes

- [x] **Additive, non-breaking** proto change: add a new server-streaming RPC `ExportEvents(ExportEventsRequest) returns (stream ExportEventsResponse)` to `LedgerService` in `packages/proto/ledger/v1/ledger.proto`, plus the new `ExportEventsRequest` / `ExportEventsResponse` messages. Adding an RPC and new messages is additive, so `buf breaking` must pass unchanged.
- Run `./scripts/buf-gen.sh` and confirm `git diff packages/proto/gen/` shows only the additive stubs.
- **Approval gate:** 1 service owner (`xstockstrat-ledger`) + Proto Reviewer (additive proto change; this is *not* a breaking change, so the 2-owners-plus-platform-lead gate does not apply). See `docs/runbooks/proto-versioning.md` and root CLAUDE.md § Approval Flow.

## Config Key Changes

- `ledger.export.max_window_days` — integer; maximum allowed export date range (default: 365)
- `ledger.export.enabled` — boolean feature flag (default: true)

## Database Changes

- [x] No schema changes (reads from existing ledger events hypertable)
- Note: ensure a composite index that supports the `(event_type, occurred_at)` window scan exists — verify at design/impl-spec time

## Feature Workflow Notes

Branch to create: `feature/ledger-event-export` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner (`xstockstrat-ledger`) + Proto Reviewer (additive, non-breaking proto RPC addition)
- [x] Config owner + config team (two new `ledger.export.*` config keys)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (change is additive)
- [ ] DBA review + service owner (schema migration) — not applicable (read-only; index check at design)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Design-Phase Decisions (owned by /sdd-design)

- Which `xstockstrat-ui` segment hosts the "Export events" download button — `/trader` (fill-centric export) vs `/insights` (review-centric). Both segments already proxy ledger reads through their BFFs, so either is viable; `/sdd-design` picks one and records it in `design.md`. This is a decided-at-design choice, **not** an open-ended deferral (C-14).

## Design Guardrails

Non-blocking traps to honor during design and implementation (carried from the ledger; not open questions):

- **Config-key native type** (ledger `fails.md` 2026-08-16, signal-time-decay): verify at recon which native type Node receives for `ledger.export.max_window_days` / `ledger.export.enabled` off the WatchConfig stream, and cast explicitly at the call-site — a stored `0` / `false` can read falsy and silently fall back to the default instead of the operator-set value.
- **Ledger global-sequence ordering** (`insights.md` 2026-08-26, feature 042): the ledger `sequence` is monotonic across the *whole* stream, not per `stream_key`; order exported rows by that global `sequence` so the export is deterministic. (Confirmed in `packages/proto/ledger/v1/ledger.proto` — `LedgerEvent.sequence` is the global monotonic sequence.)

## Open Questions

None — the transport question is resolved inline (FR-1 / FR-5: a server-streaming gRPC `ExportEvents` RPC on `xstockstrat-ledger`, fronted by an `xstockstrat-ui` BFF route; no nginx, no ledger HTTP `8057`). The remaining decisions have moved to § Design-Phase Decisions and § Design Guardrails above.
