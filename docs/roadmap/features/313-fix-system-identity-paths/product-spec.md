# Product Spec: fix-system-identity-paths

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md`, `docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### mcp_client loop ledger events are stored with a NULL owner (SEV-3)

- **Observed**: the server-side `mcp_client` poll loop calls `_ingest_external_signal` with `owner=` but no
  `propagation_meta`; the `ingest.signal.ingested` AppendEvent sets no `AppendEventRequest.user_id` and
  forwards `metadata=None`, so ledger resolves the owner to NULL (no trace id either) and `ExportEvents`
  (scoped `user_id = caller`) never returns the events to the source owner. The same event via
  `IngestSignal` is owner-stamped.
- **Expected**: the AppendEvent sets `user_id=owner` explicitly; optionally a trace id is minted per cycle.
- Report: [`docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md`](../../../reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md)

### P&L snapshot compose can raise ValueError for a system-owned order event (SEV-3)

- **Observed**: `_compose` is documented never to raise (FR-6) but calls `owner_metadata(owner)` outside any
  try; `owner_metadata` raises ValueError for `system`, so no snapshot or `pnl_positions` window is written
  for that event. Unreachable today (trading is the only `order.*` producer and never carries
  `user_id: system`; trading has no explicit `system` guard).
- **Expected**: a `system` owner degrades to a partial snapshot, the same way the empty-owner branch skips
  indicators and signals.
- Report: [`docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md`](../../../reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md)

## Reproduction Steps

1. Ingest: register an `mcp_client` source, wait one `ingest.mcp_client.poll_interval_seconds`, query
   `ledger.events` for that cycle's `event_type='ingest.signal.ingested'` → `user_id` is NULL.
2. Analysis: feed `process_event` an `order.filled` event whose payload has `user_id: "system"` → log
   "owner-scoped call needs a real owner"; no `order_snapshots` / `pnl_positions` row for that order.
   (Report 2 reproduced the mechanism with a scratch pytest, 3/3.)

## Root Cause Hypothesis

Ownership reaches the ledger only through the propagated header, and the server-initiated loop has no
inbound request; the feature-225 fail-closed identity helper was inserted ahead of the FR-6 degrade blocks
(commit 7276674). Current sites (main-dev @ 0fecb24d):

- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:158-160` — `_ingest_external_signal(..., owner=owner)`, no metadata.
- `services/xstockstrat-ingest/app/handlers/servicer.py:1015` `_ingest_external_signal`; `:1172-1182` the
  AppendEvent with no `user_id` and `metadata=propagation_meta`.
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:78` — owner = `req.userId` → `x-user-id` → null;
  `packages/proto/ledger/v1/ledger.proto:51` `string user_id = 9`.
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:532,539` — `_compose`,
  `meta = owner_metadata(owner) if owner else ()`; `app/identity.py:8` the `SYSTEM_IDENTITY` raise.
- Drift since the report: the per-event handler is now `_process_with_retry` (`pnl_pattern_consumer.py:228`);
  ValueError is in `_POISON` (`:65-66`), so the event is retried then parked rather than skipped by the cursor
  advance — still no snapshot is written.

## Affected Services

- xstockstrat-ingest (mcp_client loop ledger owner)
- xstockstrat-analysis (P&L snapshot compose)
- xstockstrat-ledger (owner resolution; named by report 1, no change expected)

## Fix Scope

- Proto changes: **no** — `AppendEventRequest.user_id` (field 9) already exists.
- DB migrations: **no** — neither report names a schema change; backfilling existing NULL-owner events is an Open Question.
- Config key changes: **no** — no report names a key.

## Open Questions

1. Report 1: mint a trace id per poll cycle (report calls it optional) — in scope?
2. Report 1: existing `ingest.signal.ingested` rows with NULL `user_id` — leave (ledger is append-only) or attribute?
3. Report 2: is the fix only the analysis degrade, or should trading also gain an explicit `system` guard on `order.*` producers (report notes there is none)?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Making the `system` order path reachable — report 2 is a latent guard only.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
