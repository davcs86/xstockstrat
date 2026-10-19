# Defect: Fundamentals producer emits fabricated 0.5 scores for symbols with no data

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: fabricated-signal
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution.md — Gotchas, feature 144 bullet ("A near-identical neutral-fallback shape also exists in … `_builtin_score` … left unfixed")

## Observed
`_builtin_score` returns 0.5 when no metric is usable (for example an ETF with no P/E, P/B, ROE,
D/E or EPS). That value takes part in the cross-sectional quantile mapping. With the default
`min_conviction_to_emit` of 0.0 it is emitted to ingest as a real `ExternalSignal` with conviction
0.5. When most of the universe has no data, `buy_cut` can equal 0.5, and every data-less symbol is
then emitted as `buy`. Metrics whose value is legitimately 0 are also dropped, because each check
tests truthiness.

## Expected
A symbol with no usable fundamentals is skipped or flagged as unavailable, never scored as a neutral
real value (the feature 144 `score_unavailable` pattern).

## Reproduction
1. Set `analysis.fundsignal.universe_source=explicit` and use 5 ETFs plus 1 stock.
2. Call `RunFundamentalsScan(dry_run=true)`.
3. The ETFs carry score 0.5 and a buy/sell/hold direction.

## Evidence
`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:432`
> return sum(parts) / len(parts) if parts else 0.5

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:240`
> if score < min_conv:

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:479`
> if s >= buy_cut:

## Root cause hypothesis
The neutral fallback cannot be told apart from a computed mid-range score. Feature 144 fixed the same
shape in the screener but not in the producer.

## Confidence
high
