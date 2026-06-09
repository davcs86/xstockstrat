# Context: backfill-backtest-coverage

**Feature**: `docs/roadmap/features/053-backfill-backtest-coverage/feature.md`
**Product Spec**: `docs/roadmap/features/053-backfill-backtest-coverage/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/053-backfill-backtest-coverage/implementation-spec.md`

---

## Session 2026-06-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- P1 of a three-bucket backfill-hardening initiative (P0 = `durable-observable-backfills`,
  P1 here, P2 = `resumable-chunked-backfills`).
- Story grounded in a code audit:
  - `services/xstockstrat-analysis/app/handlers/servicer.py:268` fetches bars via `GetBars` with
    `timeframe="1Day"`; on `len(bars) < slow_period + 2` it returns `[], initial_equity,
    [initial_equity]` (silent flat-equity no-op, only a log.warning).
  - The historical-backfill runbook and `TriggerBackfill` examples use `"1d"` — a vocabulary
    mismatch with the backtest path's `"1Day"`.
  - No coverage/gap query RPC exists on marketdata today.
- Depends on nothing in P0 for the contract, but the `GetDataCoverage` primitive defined here is a
  prerequisite for P2's "fill only the gaps" mode.

## Session 2026-06-08 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All structural criteria passed; gate initially failed only on criterion 9 (unchecked Open
  Questions). Resolved all 4 via /sdd-review decisions:
  - Timeframe normalization: shared `Timeframe` proto enum in common/v1. This is a BREAKING proto
    change → approval gate elevated to 2 owners + Platform Lead + one-release deprecation cycle.
    Reviewers table updated to add Platform Lead.
  - Insufficient-data: RunBacktest returns a soft structured result (status + coverage_gap), not an error.
  - FR-5 agent tool: deferred (out of scope; thin follow-up).
  - UI one-click backfill: out of scope (separate UI feature consuming this contract).
- Trading domain checks: skipped (non-trading feature).
- Overlap findings: shares marketdata with 052/054 (advisory WARN). No FAIL-level overlap.

## Session 2026-06-08 — scope revision (user)

- User directive: 053-Q4 must be IN scope. Reversed the earlier "UI out of scope" decision.
- Added FR-6: xstockstrat-ui backtest view renders the insufficient-data message and a "backfill
  this range" action that issues TriggerBackfill via the BFF chain (frontend-auth.md, header
  propagation). Confirms job_id after trigger.
- Live job-progress display kept as a soft follow-up (depends on P0 052 for reliable bars_total/status).
- Affected services: xstockstrat-ui promoted from downstream-consumer to in-scope implementer.
- Reviewers: added xstockstrat-ui owner (frontend service → Playwright E2E required at impl-spec).
- Scope note: feature now spans backend (marketdata + analysis proto/service) AND frontend (ui).
  Larger than P1's original backend-only footprint — flagged for the user. Status stays spec-ready.

## Session 2026-06-09 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings:
  - **`TriggerBackfill` lives on IngestService, not marketdata.** FR-6's "TriggerBackfill RPC"
    target is `packages/proto/ingest/v1/ingest.proto:12` (`IngestService.TriggerBackfill`), which
    fans out to marketdata's `BackfillBars` (`services/xstockstrat-ingest/app/handlers/servicer.py:84`).
    The UI step calls ingest's `TriggerBackfill` via the existing `ingestClient`.
  - **Timeframe mismatch is real and load-bearing.** Analysis queries `GetBars` with
    `timeframe="1Day"` (`services/xstockstrat-analysis/app/handlers/servicer.py:271,292,302,474`);
    backfill + `ingest.backfill.default_timeframe` use `"1d"`; DB stores the literal string in
    `marketdata.ohlcv.timeframe` (migration comment says canonical is `'1m','5m','1h','1d'`). Fix =
    new `internal/timeframe/` normalizer in marketdata + analysis sending `"1d"`/`TIMEFRAME_1DAY`.
  - **No new index migration / no DB schema change.** `marketdata.ohlcv` PRIMARY KEY is
    `(symbol, timeframe, time)` (`migrations/001_marketdata_hypertables.up.sql:20`) — already
    supports the MIN/MAX/COUNT coverage scan. Matches the product-spec Database Changes box.
  - **Timeframe enum migration is additive in this feature (no v2).** Per `proto-versioning.md`,
    add `common.v1.Timeframe` enum + `timeframe_enum` fields alongside the existing string fields
    marked `[deprecated = true]`; the breaking string removal is deferred to a future release.
    `buf breaking` passes this feature's steps.
  - **No new env vars / ports.** UI→ingest uses the already-wired `INGEST_ENDPOINT` (present in
    docker-compose.yml:452 and both DO app specs at line 411 in the ui block).
  - **Coverage threshold met via `internal/timeframe/`** (not CI-excluded), since the DB query +
    service/handler wiring sit in excluded packages (`repository/`,`service/`,`handler/`).
  - Insufficient-data no-op confirmed at `servicer.py:277-281` and `:478-480` (returns fabricated
    flat equity with only a log.warning) — replaced by structured `BACKTEST_STATUS_INSUFFICIENT_DATA`
    + `coverage_gaps`.
- Reviewers snapshot in feature.md already matched the per-step reviewer set (Proto Reviewer,
  Platform Lead, marketdata owner, analysis owner, ui owner) — left as the canonical snapshot.
