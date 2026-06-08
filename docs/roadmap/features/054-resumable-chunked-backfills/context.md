# Context: resumable-chunked-backfills

**Feature**: `docs/roadmap/features/054-resumable-chunked-backfills/feature.md`
**Product Spec**: `docs/roadmap/features/054-resumable-chunked-backfills/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/054-resumable-chunked-backfills/implementation-spec.md`

---

## Session 2026-06-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- P2 of a three-bucket backfill-hardening initiative (P0 = `durable-observable-backfills`,
  P1 = `backfill-backtest-coverage`, P2 here).
- **Sequencing matters**: P2 depends on P0's `ingest.backfill_jobs` table + concurrency gate, and on
  P1's `GetDataCoverage` RPC for the GAPS_ONLY mode. Do not execute P2 before P0 (and P1 for FR-4)
  are merged to main-dev. The DB migration must run-order after P0's migration.
- Story grounded in a code audit:
  - `_run_backfill` issues one monolithic `BackfillBars` call — no chunking, no resume.
  - `docs/runbooks/historical-backfill.md` "Large Backfill Strategy" tells operators to manually
    split into per-year loops — this feature moves that into the server.
  - Only knob today is a binary `overwrite` flag; no gap-aware refresh.
