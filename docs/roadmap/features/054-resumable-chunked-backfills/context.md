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

## Session 2026-06-08 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All structural criteria passed; gate initially failed only on criterion 9 (unchecked Open
  Questions). Resolved all 5 via /sdd-review decisions:
  - Chunk strategy: both time-window + symbol-batch; density-driven sizing; chunk_max_bars hard cap.
  - Resume idempotency: chunk COMPLETED only after clean fetch; re-fetch whole window relying on
    marketdata upsert. Impl-spec must verify marketdata OHLCV write is an upsert (not insert-only).
  - Chunk concurrency: separate key `ingest.backfill.max_concurrent_chunks` (default 3).
  - Retention: same as backfill_jobs; chunks FK-bound, cascade with parent.
  - GAPS_ONLY default: yes for agent-scheduled (feature 010) refreshes; manual triggers default FULL.
- Recorded blocking deps in merge-order.md: 054 waits for 052 (backfill_jobs table + concurrency
  gate, migration run-order) and 053 (GetDataCoverage for GAPS_ONLY).
- Trading domain checks: N/A — "Alpaca"/"backfill"(contains "fill") matched incidentally; no
  order/fill lifecycle behavior touched.
