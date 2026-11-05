# Defect: Analysis CLAUDE.md omits the attribution net contract and misstates _bars_fetch_sem scope

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution-findings.md — Documentation-that-lies rows 1 (P&L section) and 2 (`max_concurrent_bars_fetches` enrichment)

## Observed
1. CLAUDE.md has zero mentions of `GetAttribution` or `fees_total`. Its P&L section describes only
   gross `realized_pnl`, so the net-of-fees contract (ANALYSIS-9, migration 021) is invisible.
2. Four sites still claim `_bars_fetch_sem` bounds live enrichment or the opportunities benchmark
   fetch: the CLAUDE.md config row (L525), CLAUDE.md L330-332, the `_enrich_opportunities_live`
   docstring, and the code comment at servicer L5528-5530. In the code, enrichment is one
   `BatchGetLatestPrice` under `asyncio.wait_for` with no semaphore. The compute pass uses
   `_readiness_materializer_bars_sem`. `_bars_fetch_sem` bounds only the EvaluateReadiness slow path.

## Expected
CLAUDE.md documents `GetAttribution` and the rule net = `realized_pnl − fees_total` (computed only at
attribution). All four sites state the current semaphore scope.

## Reproduction
1. `grep -n "GetAttribution\|fees_total" services/xstockstrat-analysis/CLAUDE.md` → no hits.
2. Read `servicer.py:4688` and compare with `servicer.py:4737`.

## Evidence
`services/xstockstrat-analysis/app/handlers/servicer.py:4300`
> async def GetAttribution(self, request, context):

`services/xstockstrat-analysis/app/handlers/servicer.py:4338`
> win = net > 0.0  # net of fees (AC-6/AC-10/AC-11)

`services/xstockstrat-analysis/app/handlers/servicer.py:4688`
> ranking input (FR-8/AC-14). Fan-out is bounded by the existing _bars_fetch_sem and deduped

`services/xstockstrat-analysis/app/handlers/servicer.py:4737`
> price_resp = await asyncio.wait_for(

`services/xstockstrat-analysis/CLAUDE.md:332`
> fetch under `_bars_fetch_sem`.

## Root cause hypothesis
Features 029/042 (attribution) and 177/185 (semaphore moves) did not update the docs and comments.

## Confidence
high
