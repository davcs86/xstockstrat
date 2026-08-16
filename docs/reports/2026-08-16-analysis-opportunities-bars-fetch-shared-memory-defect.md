# Defect: Opportunities compute intermittently fails bars fetch with "out of shared memory"

**Recorded**: 2026-08-16
**Severity**: SEV-2
**Impact type**: opportunity-queue-missing-symbols
**Environment**: staging (xstockstrat-staging)
**Affected service(s)**: xstockstrat-analysis, xstockstrat-marketdata (query target)
**Config-only fix possible**: no

## Observed

During a live `_compute_opportunities` cycle, a burst of bars-fetch calls failed:
`_compute_opportunities: bars fetch failed for AMZN/LYFT: INTERNAL: query bars: ERROR: out of
shared memory (SQLSTATE 53200)`. Affected symbols are skipped for that cycle's opportunity
scoring/readiness trace.

## Expected

Bars fetches for all candidate symbols succeed each cycle; no Postgres resource exhaustion.

## Reproduction

1. Let a live opportunity-compute cycle run in staging with a normal watchlist/held/live-strategy set.
2. Watch xstockstrat-analysis RUN logs for `_compute_opportunities: bars fetch failed`.

## Evidence

`services/xstockstrat-analysis/app/handlers/servicer.py:2590` (log site) and the candidate-set
construction above it. Two recent features widened the per-cycle candidate set that feeds this
bars-fetch loop:

- Feature 131 (`live-strategy opportunity attribution`, PR #954): adds up to
  `analysis.opportunity.max_live_strategies_per_symbol` (default 5) live-strategy-attributed
  candidate rows per held/signal symbol — a direct multiplier on bars-fetch volume.
- Feature 132 (`strategy symbol denylist`, PR #955): adds a `muted_only` bucket exempted from the
  `max_universe_size` budget cut, further widening the traced set.

## Root cause hypothesis

TimescaleDB hypertable "out of shared memory" (SQLSTATE 53200) is typically lock-table
exhaustion from scanning many chunks per query or a burst of concurrent connections. The larger
per-cycle candidate count introduced by 131 (primarily) and 132 (secondarily) plausibly pushed an
already-borderline bars query over that threshold. Not yet confirmed against a memory/connection
profile.

## Confidence

low
