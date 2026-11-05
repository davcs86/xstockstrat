# Defect: one candidate's non-RpcError aborts the whole per-user opportunities compute

**Recorded**: 2026-10-28
**Severity**: SEV-2
**Impact type**: request-failure-amplification
**Environment**: dev (main-dev) @ 971983e2
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: feature 245 (fix-screener-symbol-isolation) design.md item 8 — sibling un-isolated gather found during recon (recon.md:215-217)

## Observed
`_compute_opportunities` fans out `_row_for` over the selected candidates with `asyncio.gather` and
no `return_exceptions`. `_row_for` catches only `grpc.RpcError` around
`evaluate_conditions_traced`, which marks that one candidate data-unavailable (feature 185). Any other
exception from one candidate, including a `FormulaExecutionError` from a user's custom formula,
propagates out of the gather and aborts the entire compute for that user. Both callers swallow it:
the background recompute counts a failure (a cold read ends at `compute_failed` after
`_OPPORTUNITY_COMPUTE_MAX_ATTEMPTS`), and the daily refresh logs and skips the user. One bad
candidate therefore leaves the user's whole queue stale or empty. Confirmed by code read; the
reproduction below was not run.

The `FormulaExecutionError` propagation is a **deliberate** feature-185 choice, recorded in the
code comment at `servicer.py:5694-5698`:

> deliberate abort-contract change: the gather had no return_exceptions, so one RpcError previously
> aborted the entire compute). FormulaExecutionError is a formula bug, NOT a data outage, so it is
> left to propagate.

Feature 245 diverges from that choice for the screener only: `ScreenerEngine.screen()` now isolates
`Exception` per symbol (degraded `eval_failed` row), while this opportunities path still catches only
`RpcError`. Triage must decide whether the 185 contract should stand here or be aligned with the
screener; the divergence is recorded in feature 245 design.md item 8.

## Expected
A candidate whose evaluation raises degrades to its own row (for example the `"unavailable"`
provenance row, or a distinct formula-fault marker) and the remaining candidates are materialized.

## Reproduction
1. In a test, make `evaluate_conditions_traced` raise `FormulaExecutionError` (or a
   `ZeroDivisionError`) for one candidate symbol.
2. Run `_compute_opportunities` for a user with that candidate and several healthy ones.
3. The compute raises; no rows are written for the healthy candidates.

## Evidence
`services/xstockstrat-analysis/app/handlers/servicer.py:5776`
> rows = [r for r in await asyncio.gather(*[_row_for(c) for c in selected]) if r is not None]

`services/xstockstrat-analysis/app/handlers/servicer.py:5693`
> except grpc.RpcError as e:

`services/xstockstrat-analysis/app/handlers/servicer.py:5698`
> # is a formula bug, NOT a data outage, so it is left to propagate.

`services/xstockstrat-analysis/app/handlers/servicer.py:4807`
> rows = await self._compute_opportunities(user_id, propagation_meta)

`services/xstockstrat-analysis/app/handlers/servicer.py:5897`
> rows = await self._compute_opportunities(uid, meta)

## Root cause hypothesis
Feature 185 isolated only transport errors (`grpc.RpcError`) in `_row_for` and deliberately let
`FormulaExecutionError` and any other exception abort the compute; there is no outer per-candidate guard.

## Confidence
high
