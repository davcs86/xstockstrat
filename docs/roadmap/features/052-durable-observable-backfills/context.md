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

## Session 2026-06-08 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings (corrections / confirmations vs. product spec):
  - **Migration number is `003`, not `002`**: `ls services/xstockstrat-ingest/migrations/` shows
    last file is `002_add_signal_sources_registry.{up,down}.sql`. The product spec assumed "next
    after `001_newsletter_signals`" — corrected to `003_backfill_jobs.{up,down}.sql`. The `ingest`
    schema is created in `000_schema.up.sql`, so no `CREATE SCHEMA`.
  - **Proto field numbers confirmed**: `BackfillJob` uses 1–10 (`error=10`) → `failed_symbols=11`
    (matches 054-overlap note). `BackfillBarsResponse` uses 1–2 → `expected_bars=3`. Both additive
    → non-breaking.
  - **Notify wiring already exists for ingest**: `NOTIFY_ENDPOINT=xstockstrat-notify:50059` is
    present in all three deployment files (docker-compose L308, .do/app.dev.yaml L210, .do/app.yaml
    L210) — but the ingest servicer has **no** notify channel today (`__init__` takes only
    config/marketdata/ledger/db). main.py also doesn't read NOTIFY_ENDPOINT yet. So no
    deployment-file change is needed; only main.py + servicer must add the notify stub. EmitAlert
    shape reference: `analysis/app/engine/live_loop.py` L156–167.
  - **Inert config keys confirmed**: grep for `max_concurrent_jobs` / `retry_on_failure` in
    `services/xstockstrat-ingest/` matches only CLAUDE.md — no code reads them today. New key
    `ingest.backfill.max_retry_attempts` (default 3) added via watcher `@property` accessors
    (pattern: `sandbox_timeout_ms` in watcher.py). Config keys served live via WatchConfig → no env
    change.
  - **Existing tests manipulate `self._jobs` directly** (test_ingest_servicer.py L47/66/92/207/244)
    — must be rewritten in Step 10 since the dict is dropped. Coverage threshold 40%.
  - **marketdata `BackfillBars`** is in `internal/service/marketdata_service.go` L131–197 (returns
    `BackfillBarsResponse{BarsWritten, FailedSymbols}`). `internal/service/` is **excluded** from Go
    CI coverage measurement (COVERPKGS filter), so Step 11 requires a test but no coverage gate;
    there is no existing `marketdata_service_test.go`. Estimate computed locally → no new outbound
    gRPC call, no header-propagation change for marketdata.
  - **Not trading-domain-relevant**: only TRADING_MODE ref in ingest is telemetry tagging
    (telemetry.py L29) — Step 5b trading constraints do not apply.
