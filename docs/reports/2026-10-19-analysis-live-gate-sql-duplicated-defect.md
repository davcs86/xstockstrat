# Defect: Entry-backfill re-types the live-enabled gate SQL instead of importing it

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: gate-divergence-risk
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution-findings.md — Open question "Is `LIVE_ENABLED_PREDICATE_SQL` meant to be the single source …"; constitution ANALYSIS-7

## Observed
ANALYSIS-7 requires the live gate (`active AND live_enabled`) never to diverge between sites.
`entry_backfill.py` hard-codes the SQL literal, while `live_loop.py` and
`StrategiesRepository.list_live_enabled` use the `LIVE_ENABLED_PREDICATE_SQL` constant. A future
edit to the constant silently leaves the boot entry-time backfill on the old gate.

## Expected
`entry_backfill.py` uses `LIVE_ENABLED_PREDICATE_SQL` (lazy import if a cycle exists) or calls
`list_live_enabled`.

## Reproduction
1. Read `app/engine/entry_backfill.py:60`.
2. Compare with `app/repositories/strategies.py:19`.

## Evidence
`services/xstockstrat-analysis/app/engine/entry_backfill.py:60`
> "SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"

`services/xstockstrat-analysis/app/repositories/strategies.py:19`
> LIVE_ENABLED_PREDICATE_SQL = "live_enabled = TRUE AND active = TRUE"

## Root cause hypothesis
The literal was likely duplicated to avoid an import cycle through `servicer.py`.

## Confidence
high
