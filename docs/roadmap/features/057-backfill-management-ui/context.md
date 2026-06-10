# Context: backfill-management-ui

**Feature**: `docs/roadmap/features/057-backfill-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/057-backfill-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/057-backfill-management-ui/implementation-spec.md`

---

## Session 2026-06-10 — backlog capture

- Created feature.md at `idea` status as a backlog entry.

## Session 2026-06-10 — sdd-story

- Upgraded feature.md `idea` → `draft`; wrote product-spec.md and this context log.
- Codebase grounding (found via grep, not invented):
  - `packages/proto/ingest/v1/ingest.proto` `IngestService` has `TriggerBackfill`,
    `GetBackfillStatus`, `ListBackfillJobs` (paginated, `status_filter` only). **No
    `CancelBackfill`** RPC.
  - `BackfillJob` already carries rich progress: `bars_processed`, `bars_total`,
    `chunks_completed`/`chunks_total`, `failed_symbols`, `error`, status enum — added by
    features 052 (durable-observable-backfills) and 054 (resumable-chunked-backfills),
    both launched.
  - `ListBackfillJobsRequest` has no ticker/symbol filter → additive field needed.
  - `packages/proto/marketdata/v1/marketdata.proto` has `BackfillBars` but **no delete RPC**
    → FR-5 (delete backfilled data) needs a new scoped `DeleteBackfilledData` RPC owned by
    marketdata (OHLCV hypertable store).
  - No backfill UI page exists in `xstockstrat-ui`.
- Governance notes:
  - This is the UI layer over the launched 052/053/054 backfill-hardening backend; scoped
    distinct from them (cross-referenced in summary).
  - FR-5 is a **destructive data op** on the OHLCV hypertable → DBA gate for partition-safe,
    bounded deletes (no full-table wipes); UI needs typed confirmation.
  - All proto changes intended additive (single-owner gate, `buf breaking` green).

## Next action

`/sdd-review backfill-management-ui product-spec`, then `/sdd-spec backfill-management-ui`.
