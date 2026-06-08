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
