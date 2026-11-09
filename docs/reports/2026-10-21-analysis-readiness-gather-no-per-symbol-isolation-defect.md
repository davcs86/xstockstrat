# Defect: EvaluateReadiness fails entirely when one symbol's readiness compute raises

**Recorded**: 2026-10-28
**Severity**: SEV-2
**Impact type**: request-failure-amplification
**Environment**: dev (main-dev) @ 971983e2
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: feature 245 (fix-screener-symbol-isolation) design.md item 8 — sibling un-isolated gather found during recon (recon.md:215-217)

## Observed
`EvaluateReadiness` fans out `_readiness_for` over `request.symbols` with `asyncio.gather` and no
`return_exceptions`. `_readiness_for` has no per-symbol `try/except`: the SLOW path awaits
`_load_fundamentals`, `_load_fundamentals_snapshot`, `_sector_definition` and `compute_readiness_row`
unguarded. Any exception from one symbol (a `FormulaExecutionError`, an arithmetic error, an
unexpected `grpc.RpcError` that escapes those helpers) propagates out of the gather and fails the
whole RPC as gRPC UNKNOWN. The other symbols' readiness is lost, and their already-computed SLOW
rows are never persisted to `readiness_cache` (the `upsert_many` runs after the gather).
Confirmed by code read; the reproduction below was not run.

## Expected
A failing symbol degrades to its own readiness entry (for example an empty/unavailable
`SymbolReadiness`) and the remaining symbols are returned and cached.

## Reproduction
1. In a test, make `compute_readiness_row` raise (e.g. a `ZeroDivisionError`) for one symbol.
2. Call `EvaluateReadiness` with that symbol and several healthy ones.
3. The RPC aborts UNKNOWN; no readiness is returned for the healthy symbols.

## Evidence
`services/xstockstrat-analysis/app/handlers/servicer.py:3983`
> results = await asyncio.gather(*[_readiness_for(s) for s in request.symbols])

`services/xstockstrat-analysis/app/handlers/servicer.py:3911`
> async def _readiness_for(symbol):

`services/xstockstrat-analysis/app/handlers/servicer.py:3939`
> staged = await compute_readiness_row(

## Root cause hypothesis
Same shape as the screener defect fixed by feature 245: a concurrent per-symbol fan-out with no
per-symbol isolation. Feature 245 isolates only `ScreenerEngine.screen()`; this gather was left as is.

## Confidence
high
