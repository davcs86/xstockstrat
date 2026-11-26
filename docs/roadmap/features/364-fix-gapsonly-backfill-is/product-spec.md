# Product Spec: fix-gapsonly-backfill-is

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-25

---

## Problem Statement

Observed: on homelab staging, ~19 symbols (SCHW, IDXX, RLI, NJR, …) had no daily bars from
2026-04-01 to 2026-09-25 while bars before and after existed. GAPS_ONLY backfills over 365-day ranges
completed with 2–3 bars per symbol and status COMPLETED; the hole remained, leaving SMA200
uncomputable (opportunity condition `px > sma200` traced threshold 0.0 / UNSPECIFIED for 27 symbols).
Only a FULL + overwrite backfill repaired it.

Expected: a GAPS_ONLY backfill over a range fetches every missing trading session inside it,
including interior holes, or at minimum never reports COMPLETED while sessions in the requested range
are missing.

## Reproduction Steps

1. For a symbol with daily bars, remove an interior window of bars while keeping bars before and after.
2. `trigger_backfill(symbols=[SYM], fill_mode="gaps_only", start=<before hole>, end=<after hole>)`.
3. The job ends COMPLETED; `query_bars` still shows the hole.

## Root Cause Hypothesis

`MarketDataRepo.GetCoverage` returns only (earliest, latest, count) and `timeframe.ComputeGaps`
(`services/xstockstrat-marketdata/internal/timeframe/timeframe.go:82-99`, "interior holes out of
scope") derives only head/tail gaps from that span, so `GetDataCoverage.gaps` — consumed by ingest's
GAPS_ONLY planner (`services/xstockstrat-ingest/app/handlers/servicer.py:797-811`) — cannot express an
interior hole.

## Affected Services

- xstockstrat-marketdata (GetDataCoverage gap computation)
- xstockstrat-ingest (GAPS_ONLY work-range planning)
- Consumer surfaces relying on GAPS_ONLY: xstockstrat-ui "Backfill missing data" (feature 343,
  non-admin GAPS_ONLY), agent-scheduled backfills (feature 054 default)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
