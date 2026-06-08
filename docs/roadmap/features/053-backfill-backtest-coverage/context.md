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
