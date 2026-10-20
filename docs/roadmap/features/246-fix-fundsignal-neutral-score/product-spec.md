# Product Spec: fix-fundsignal-neutral-score

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Who is affected.** Traders and agents who act on fundamentals-sourced opportunities
(`/insights/opportunities`, MCP `list_opportunities`), and the live fundamentals blend strategy, whose
universe is every symbol carrying a fundamentals-source signal
(`services/xstockstrat-analysis/app/engine/live_loop.py:149-192`).

**Observed.** `_builtin_score` returns `0.5` when no metric is usable
(`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:432`). An ETF with no P/E, P/B, ROE, D/E or EPS
is one example. Three things follow:

- The 0.5 enters the cross-sectional quantile mapping (`_map_directions`, `:479`).
- With the default `analysis.fundsignal.min_conviction_to_emit` of 0.0 (`:240`), the 0.5 is emitted to ingest
  `IngestSignal` as a real `ExternalSignal` with conviction 0.5.
- When most of the universe has no data, `buy_cut` equals 0.5 and every data-less symbol is emitted as `buy`.

Separately, every metric check tests truthiness (`if pe:`, `if f.roe:` …), so a legitimately reported 0
(e.g. `roe` 0.0) is dropped as if absent.

**Expected.** A symbol with no usable fundamentals is never given a neutral score that looks real: it is
never scored, ranked or emitted. This is stricter than feature 144's `score_unavailable`, which still ranks
the flagged candidate, sorted last (`services/xstockstrat-analysis/docs/context-constitution.md:42`). A
metric's absence is read from `Fundamentals.missing_metrics` (proto field 18), not from a zero value.

## Functional Requirements

- **FR-1**: Under the built-in scorer (`analysis.fundsignal.scoring_formula_id` empty), a symbol whose
  `Fundamentals.missing_metrics` lists every metric the scorer reads (`pe_ratio`, `pb_ratio`, `roe`,
  `debt_to_equity`, `eps`) gets no score. It is left out of the `_map_directions` quantile, gets no
  `analysis.fundsignal_emitted` row, and is not sent to ingest `IngestSignal`.
- **FR-2**: The built-in scorer reads a metric's absence from `Fundamentals.missing_metrics`, never from a
  zero value. A metric not listed there is scored at its reported value, including 0.0. A partial row is
  scored from its present metrics only.

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

- ingest signals under the `analysis.fundsignal.source_slug` source (default `fundamentals`). Readers:
  - `ListOpportunities`, rendered at `/insights/opportunities`
    (`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx`) and MCP `list_opportunities`
    (`services/xstockstrat-agent/app/tools.py`): fabricated fundamentals-source signal rows for data-less
    symbols no longer appear.
  - the live loop's fundamentals blend universe (`live_loop.py:149-192`, signals ∩ symbols with a
    fundamentals row): data-less symbols drop out, because they no longer carry a fundamentals-source signal.
- `RunFundamentalsScan` (admin, MCP `run_fundamentals_scan`): data-less symbols are no longer emitted.

## Fix Scope

- [x] No proto changes anticipated: absence uses the existing `Fundamentals.missing_metrics` (field 18)
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Open for Design

- **Formula path (`_score_via_formula`).** It is not exempt. `fundsignal_loop.py:452-459` passes the raw
  wire values and ignores `missing_metrics` (which `marketdata.proto:218` requires consumers to check), so
  under a configured `scoring_formula_id` a data-less ETF is scored from wire-default zeros, then ranked and
  emitted. The path is opt-in: config migration `008_analysis_fundsignal_keys.up.sql:34-35` seeds the id
  empty. Design either extends the FR-1 all-missing skip to this path or names a follow-up feature.
  Durable `@feature-201 @AC-8` (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47-53`)
  fixes this path's partial-row behaviour and is PRESERVE; an all-missing skip does not change it.

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) must fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Also, existing tests pass and the affected service is smoke-tested on dev.

## Out of Scope

- Retracting or repairing fundamentals signals that ingest has already stored with the fabricated 0.5
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
