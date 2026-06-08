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
