# Product Spec: fix-fundsignal-neutral-score

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `_builtin_score` returns `0.5` when no metric is usable
(`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:432`). An ETF with no P/E, P/B, ROE, D/E or EPS
is one example. Three things follow:

- The 0.5 enters the cross-sectional quantile mapping (`_map_directions`, `:479`).
- With the default `analysis.fundsignal.min_conviction_to_emit` of 0.0 (`:240`), the 0.5 is emitted to ingest
  `IngestSignal` as a real `ExternalSignal` with conviction 0.5.
- When most of the universe has no data, `buy_cut` equals 0.5 and every data-less symbol is emitted as `buy`.

Separately, every metric check tests truthiness (`if pe:`, `if f.roe:` …), so a legitimately reported 0
(e.g. `roe` 0.0) is dropped as if absent.

**Expected.** A symbol with no usable fundamentals is never given a neutral score that looks real. It is
skipped or flagged unavailable, never scored, ranked or emitted, following the feature 144 `score_unavailable`
pattern. A metric's absence is read from `Fundamentals.missing_metrics` (proto field 18), not from a zero
value.

## Reproduction Steps

1. Set `analysis.fundsignal.universe_source=explicit` with 5 ETFs and 1 stock.
2. Run a producer cycle: call `RunFundamentalsScan` with `dry_run=false`, or `run_once` in a test.
3. The ETFs carry score 0.5 and a buy/sell/hold direction, and they are emitted.

Correction: the report says `dry_run=true`. That path returns before scoring (`fundsignal_loop.py:195`), so
it cannot show the bug. See context.md.

## Root Cause Hypothesis

The neutral fallback cannot be told apart from a computed mid-range score. Feature 144 fixed the same shape in
the screener (`score_unavailable`, `services/xstockstrat-analysis/docs/context-constitution.md:42`) but left
the producer unfixed. The truthiness tests treat "0" as "absent" because proto3 doubles have no wire
presence; `missing_metrics` is the existing presence signal.

## Affected Services

- xstockstrat-analysis: code change, in the built-in scorer and its callers in `run_once` / `_map_directions`.
- xstockstrat-ingest: downstream recipient of the fabricated signals only. No ingest code change is
  anticipated.

## Consumer Surface(s)

- ingest signals under the `analysis.fundsignal.source_slug` source (default `fundamentals`). These are read by
  `ListOpportunities`, the live loop's fundamentals blend universe, and MCP `list_opportunities`.
- `RunFundamentalsScan` (admin, MCP `run_fundamentals_scan`): data-less symbols are no longer emitted.

## Fix Scope

- [x] No proto changes anticipated: absence uses the existing `Fundamentals.missing_metrics` (field 18)
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) must fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Also, existing tests pass and the affected service is smoke-tested on dev.

## Out of Scope

- Retracting or repairing fundamentals signals that ingest has already stored with the fabricated 0.5
- The formula-scoring path (`_score_via_formula`); it already skips a failed symbol
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
