# Context: durable-observable-backfills

**Feature**: `docs/roadmap/features/052-durable-observable-backfills/feature.md`
**Product Spec**: `docs/roadmap/features/052-durable-observable-backfills/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/052-durable-observable-backfills/implementation-spec.md`

---

## Session 2026-06-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- P0 of a three-bucket backfill-hardening initiative (P0 here, P1 = `backfill-backtest-coverage`,
  P2 = `resumable-chunked-backfills`).
- Story grounded in a code audit of `services/xstockstrat-ingest/app/handlers/servicer.py`:
  - `self._jobs` is an in-memory dict (line ~40) — not durable, not multi-replica safe.
  - `_run_backfill` sets `job.bars_processed` but never `bars_total`.
  - Only `ingest.backfill.completed` is emitted; the CLAUDE.md table also lists
    `queued`/`running`/`failed` which are not emitted.
  - No notify call on failure despite the dependency table claiming "Alert on backfill failures".
  - `retry_on_failure` and `max_concurrent_jobs` config keys exist but are not referenced/enforced.
  - `BackfillJob` proto (fields 1–10) has no `failed_symbols` field; `failed_symbols` only appears
    in the ledger payload.
- No `042` feature dir exists and `020` is duplicated; next sequence computed as `052` from the
  count-based formula (51 dirs → 052).

## Session 2026-06-08 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All structural criteria passed; gate initially failed only on criterion 9 (unchecked Open
  Questions). Resolved all 4 via /sdd-review decisions:
  - retry_on_failure + max_concurrent_jobs: IMPLEMENT both (not remove). New key
    `ingest.backfill.max_retry_attempts` (default 3); backoff 2s/4s/8s; retry failed symbols only.
  - bars_total: marketdata returns expected-bar-count via `BackfillBarsResponse` (new proto field).
  - job state: drop in-memory `self._jobs` dict entirely; read/write `ingest.backfill_jobs` (multi-replica).
  - retention: retain jobs indefinitely for now; cleanup deferred.
- Warnings: overlap with 053/054 (shared marketdata; 052+054 both edit ingest.proto BackfillJob —
  052 uses field 11, 054 must use 12+). Advisory only.
- Overlap findings: no FAIL-level (no duplicate config keys). No active concurrent feature conflicts
  (only 051-auth2-authorized-apps-ui in flight; unrelated).
