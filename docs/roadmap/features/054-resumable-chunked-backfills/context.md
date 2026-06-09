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

## Session 2026-06-09 — sdd-spec

- Generated implementation-spec.md with 9 steps (numbered 1, 2, 4, 6, 7, 8, 9 — gaps are
  intentional to keep category numbers stable; no Steps 3 or 5). Status → implementation-ready.
- **Critical prerequisite, flagged prominently in the spec's "Prerequisite Warning" section**:
  features 052 (P0) and 053 (P1) are NOT yet on main-dev. Confirmed by codebase survey:
  - No `ingest.backfill_jobs` migration (last ingest migration is `002_add_signal_sources_registry`);
    `IngestServicer` stores jobs in-memory only (`self._jobs: dict`, servicer.py:40,66). No
    concurrency gate in `_run_backfill` (servicer.py:78).
  - `ingest.backfill.max_concurrent_jobs` is documented in ingest CLAUDE.md but NOT seeded in any
    config migration and NOT read in ingest code — it ships with 052.
  - `GetDataCoverage` RPC absent from marketdata.proto (only Stream/Get/Backfill/ListAssets exist) —
    ships with 053. GAPS_ONLY (FR-4) consumes it.
  - Recommendation written into spec + feature.md Next Action: re-run /sdd-spec after 052+053 merge
    to re-ground the forward-looking references, before /sdd-execute.
- Key codebase findings:
  - **Resume idempotency is SAFE** (the /sdd-review-flagged verification): marketdata OHLCV write is
    an idempotent upsert — `marketdata_repo.go:42-47` `ON CONFLICT (symbol, timeframe, time) DO
    UPDATE`. Re-fetching a chunk's full window on resume overwrites, not duplicates. No marketdata
    code change needed for idempotency.
  - `bars_total` already exists on BackfillJob (ingest.proto:31, field 7) — FR-5 only needs to
    populate it. Next free field: TriggerBackfillRequest=5, BackfillJob=11/12.
  - Config seed pattern: `INSERT INTO config.config_values (...) VALUES (dev-row), (prod-row) ON
    CONFLICT (namespace,key,environment,trading_mode) DO NOTHING` — see config migration
    004_agent_config.up.sql. Last config migration: 004.
  - Header propagation already correct in ingest (servicer.py:67-71); new per-chunk BackfillBars +
    GetDataCoverage calls must reuse `metadata=propagation_meta`.
  - No new env vars or ports needed — ingest already wires MARKETDATA_ENDPOINT/LEDGER_ENDPOINT/
    DATABASE_URL in docker-compose + both DO app specs.

## Session 2026-06-09 — sdd-execute (sequential, stacked on 053)

Branch `feature/resumable-chunked-backfills` cut from `feature/backfill-backtest-coverage` (053),
which is itself stacked on 052. The hard prerequisites the spec flagged (052 backfill_jobs table +
concurrency gate; 053 GetDataCoverage RPC) are now present on the stacked base. Same env fallbacks
as 052/053 (host proto toolchain; throwaway postgres:16; per-feature integration PR).

### Re-spec gate (§5.3) — applied before the step loop
- BackfillJob highest field on stacked base is 12 → chunks_total=13, chunks_completed=14 (was 11/12).
- TriggerBackfillRequest highest field is 5 → fill_mode=6 (was 5).
- ingest migration NNN = 004 (052 added 003_backfill_jobs); FK parent ingest.backfill_jobs(job_id uuid) confirmed.
- config migration NNN = 005 (052 added no config migration; last is 004_agent_config).
- Committed as respec(resumable-chunked-backfills).

### Steps 1-9 — execution summary [done]
- Step 1-2 proto+regen: common Timeframe already present (053); added FillMode enum, BackfillJob
  chunks_total=13/chunks_completed=14, TriggerBackfillRequest fill_mode=6. buf lint+breaking pass.
- Step 4 migration 004_add_backfill_chunks: ingest.backfill_chunks (FK→backfill_jobs cascade,
  (job_id,status) index). Verified up+down+FK on throwaway pg.
- Step 6 service: watcher chunk config helpers; backfill_chunks repo (pure plan_chunks density-aware,
  insert/get_incomplete/mark_*; list_jobs_with_incomplete_chunks; estimate_bars). Rewrote servicer
  _execute_backfill → chunk planning/persist/execute under chunk semaphore w/ per-chunk retry (FR-8);
  GAPS_ONLY via marketdata.GetDataCoverage; _finalize_backfill shared; resume_incomplete_jobs +
  _resume_job; main.py resume-on-startup after reconcile. USER DECISION: full chunked rewrite
  (replaces 052 single-fetch model) — see Deviation Log.
- Step 7 tests: updated 052 servicer tests to chunked model (patch_chunk_repo helper, make_servicer
  chunk config) + new plan_chunks/estimate_bars/chunk-repo/resume/GAPS_ONLY/chunk-concurrency tests.
  121 passed, cov 74%.
- Step 8 config migration 005_ingest_backfill_chunking (3 keys × dev/prod, verified up+down on pg) +
  ingest CLAUDE.md config table + Database section.
- Step 9 docs: historical-backfill.md Large Backfill Strategy → server-side chunking + GAPS_ONLY + resume.

All steps done → code-completed. merge-order: 054 merges LAST (after 052 then 053). No breaking proto
(FillMode + chunk fields are additive); inherits 053's Platform Lead gate transitively via stacking.
