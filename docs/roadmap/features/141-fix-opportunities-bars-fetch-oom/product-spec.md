# Product Spec: fix-opportunities-bars-fetch-oom

**Type**: bug
**GitHub Issue**: n/a — see `docs/reports/2026-08-16-analysis-opportunities-bars-fetch-shared-memory-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-16

---

## Problem Statement

During a live `_compute_opportunities` cycle, `xstockstrat-analysis` observed a burst of bars-fetch
failures: `_compute_opportunities: bars fetch failed for AMZN/LYFT: INTERNAL: query bars: ERROR:
out of shared memory (SQLSTATE 53200)`. Affected symbols are skipped for that cycle's opportunity
scoring/readiness trace — the Opportunities queue traders review before deciding to enter a
position can be silently incomplete for a cycle.

Expected: bars fetches for all candidate symbols succeed each cycle; no Postgres resource
exhaustion under normal operation.

## Reproduction Steps

1. Let a live opportunity-compute cycle run in staging with a normal watchlist/held/live-strategy
   set (enough live-enabled strategies that feature 131's per-symbol fan-out is exercised).
2. Watch `xstockstrat-analysis` RUN logs for `_compute_opportunities: bars fetch failed`.

## Root Cause Hypothesis

`services/xstockstrat-analysis/app/handlers/servicer.py`'s `_compute_opportunities` builds a
per-cycle candidate set that two recent features widened:

- Feature 131 (`live-strategy opportunity attribution`, PR #954): attributes each held/signal
  symbol to up to `analysis.opportunity.max_live_strategies_per_symbol` (default 5) live
  strategies as separate candidate rows — a direct multiplier on bars-fetch volume.
- Feature 132 (`strategy symbol denylist`, PR #955): adds a `muted_only` bucket explicitly exempt
  from the `max_universe_size` budget cut, further widening the traced set.

TimescaleDB "out of shared memory" (SQLSTATE 53200) is typically lock-table exhaustion from one
query/transaction touching many hypertable chunks, or a burst of concurrent backend connections.
The larger per-cycle candidate count plausibly pushes an already-borderline bars query over that
threshold. Confidence: low — not yet confirmed against a memory/connection/lock profile; design
must investigate before committing to a specific fix shape.

## Affected Services

- `xstockstrat-analysis` (Python) — `app/handlers/servicer.py` (`_compute_opportunities`)
- `xstockstrat-marketdata` (Go) — bars query is the resource that exhausts (query target, not
  necessarily where the fix lands)

## Fix Scope

- [x] No proto changes anticipated
- [ ] Database migration/schema change — undetermined pending design investigation (e.g. if the fix
      is a Postgres tuning change rather than application code)
- [ ] Config key change — undetermined pending design investigation (e.g. tightening
      `analysis.opportunity.max_live_strategies_per_symbol`, or a new batching/dedup config key)

## Acceptance Criteria

- [ ] No `out of shared memory` (SQLSTATE 53200) errors observed across a full live compute cycle
      under a representative candidate-set size (including live-strategy fan-out and muted rows)
- [ ] Every candidate symbol in a compute cycle gets a bars-fetch result (success or a clean,
      non-resource-exhaustion error)
- [ ] Existing `xstockstrat-analysis` tests pass
- [ ] A regression test or load characterization demonstrates the fix holds under a candidate-set
      size at or above what triggered the original failure

## Out of Scope

- Any change to feature 131/132's actual attribution/denylist *semantics* — this bug fixes the
  resource-consumption side effect, not the features' product behavior
- General bars-query performance work beyond what's needed to clear the resource exhaustion
