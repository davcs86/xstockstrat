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

Who is hurt: a trader whose opportunity conditions or strategies depend on long-lookback indicators
(e.g. `px > sma200`) — the "Backfill missing data" action reports success while the indicator stays
uncomputable, so the symbol silently drops out (strategies fail closed); an operator relying on
agent-scheduled GAPS_ONLY backfills gets a false COMPLETED.

Expected: a GAPS_ONLY backfill over a range fetches every missing trading session inside it,
including interior holes, or at minimum never reports COMPLETED while sessions in the requested range
are missing.

**Trading session** (used throughout): a US-equity regular trading day — a weekday that is not a
US exchange holiday. Which calendar source defines it is a design decision (`/sdd-design`).

## Functional Requirements

- **FR-1** — A GAPS_ONLY daily-bar backfill over `[start, end]` fetches every trading session in that
  range that has no stored bar, including sessions inside an interior hole bounded by stored bars on
  both sides.
- **FR-2** — A GAPS_ONLY backfill never ends COMPLETED while a trading session in its requested range
  still has no stored bar for a requested symbol; such a job ends in a non-COMPLETED terminal state
  (or reports the still-missing sessions) instead. Sessions the vendor legitimately has no bar for
  (e.g. a halted or not-yet-listed symbol) are a design-phase decision and must be recorded in
  `design.md`.
- **FR-3** — A GAPS_ONLY backfill for a symbol with no missing trading sessions in the requested range
  fetches no bars and ends COMPLETED (no regression into FULL-style refetching).

## Reproduction Steps

1. For a symbol with daily bars, remove an interior window of bars while keeping bars before and after.
2. `trigger_backfill(symbols=[SYM], fill_mode="gaps_only", start=<before hole>, end=<after hole>)`.
3. The job ends COMPLETED; `query_bars` still shows the hole.

## Root Cause Hypothesis

`MarketDataRepo.GetCoverage` returns only (earliest, latest, count) and `timeframe.ComputeGaps`
(`services/xstockstrat-marketdata/internal/timeframe/timeframe.go:82-99`, "interior holes out of
scope") derives only head/tail gaps from that span, so `GetDataCoverage.gaps` — consumed by ingest's
GAPS_ONLY planner (`services/xstockstrat-ingest/app/handlers/servicer.py:787-811`, `_plan_work_ranges`) — cannot express an
interior hole.

## Affected Services

- xstockstrat-marketdata — code change: `GetDataCoverage` gap computation must express interior holes.
- xstockstrat-ingest — code change: GAPS_ONLY work-range planning consumes the corrected gaps and
  enforces FR-2's terminal-state rule.
- xstockstrat-ui — code change (scope widened by operator decision 2026-11-26):
  `src/lib/backtestBackfill.ts` maps a PARTIAL job whose only shortfall is `incomplete` symbols to a
  distinct "vendor has no bars" message (it leads to Re-run, then the no-vendor-data state).
- xstockstrat-agent — docs-only change: `get_backfill_status` gains the `incomplete` outcome
  automatically (enum-derived projection); its docstrings, `docs/runbooks/mcp-tools.md`, the agent
  `CLAUDE.md` and the `strat-lab` `backtest` skill are synced in the same PR
  (`docs/patterns/strat-lab-plugin.md`).
- packages/proto — `marketsession` (Go calendar package) gains the one-off NYSE closures since 2000;
  `common.proto` gains one enum value (see Proto Contract).

## Consumer Surface(s)

- `/trader` — "Backfill missing data" on the position detail page
  (`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`, feature 343, non-admin
  GAPS_ONLY). Observable: after the job, the interior hole is filled or the job is not COMPLETED.
- Agent MCP tools `trigger_backfill` (`fill_mode="gaps_only"`) and `get_backfill_status`, including
  agent-scheduled backfills (feature 054). Observable: same as above via `get_backfill_status` /
  `query_bars`.

## Fix Scope

Updated at `/sdd-spec` (2026-11-26) to match the approved design and the operator's scope decision.

- marketdata: `GetDataCoverage` reports head, interior and tail 1d gaps from stored session dates
  (`timeframe.ComputeSessionGaps`, the shared `marketsession` calendar); 15m/1h unchanged.
- ingest: the GAPS_ONLY planner coalesces each symbol's gaps into units no wider than
  `backfill.chunk_window_days`; a verify pass after the chunks (fresh and resume paths) marks a
  symbol still missing sessions `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE` with the missing ranges in its
  `reason`, and the job ends PARTIAL. The head gap is exempt (pre-listing carve-out) when the store
  has no bar in the 730 days before it — a fixed invariant, not a config key.
- ui: INCOMPLETE-only PARTIAL discriminator in `backtestBackfill.ts`.
- agent / strat-lab: documentation sync for the new `incomplete` outcome.
- Database migrations: none — the fix reads existing `marketdata` bars; no schema change.
- Config keys: none.

## Proto Contract

- Additive, non-breaking: `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` appended to
  `common.v1.BackfillSymbolOutcome` (`packages/proto/common/v1/common.proto`). Approval: 1 service
  owner (operator-accepted 2026-11-26). `buf breaking` must pass against the feature branch.
- No other wire change: `GetDataCoverageResponse.gaps = 7` already carries N gaps.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Intraday timeframes (this fix covers daily bars only; intraday interior holes are a follow-up if
  observed)
- FULL-mode backfill behavior (already a working remediation; unchanged)
- Re-backfilling the staging symbols already repaired out-of-band on 2026-11-25
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
