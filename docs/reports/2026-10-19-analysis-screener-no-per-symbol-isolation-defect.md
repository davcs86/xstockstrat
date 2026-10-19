# Defect: ScreenSymbols fails entirely when one symbol raises a non-RpcError

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: request-failure-amplification
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution-findings.md — Latent bugs row "`ScreenerEngine.screen()` has no per-symbol error isolation"

## Observed
`screen()` fans out `_eval_symbol` with `asyncio.gather` and no `return_exceptions`. `_eval_symbol`
catches only `grpc.RpcError` at its RPC sites (plus one TypeError/ValueError site). Any other
exception in one symbol, such as an arithmetic error or a failure in `scoring.compute_signal_score`,
propagates and fails the whole `ScreenSymbols` RPC as gRPC UNKNOWN. Feature 160 fixed the one
trigger but added no isolation.

## Expected
A failing symbol degrades to its own row (for example INSUFFICIENT_DATA / skipped) and the scan completes.

## Reproduction
1. Make `scoring.compute_signal_score` raise (e.g. a `ZeroDivisionError`) for one symbol in a test.
2. Call `ScreenSymbols` over 50 symbols.
3. The RPC aborts UNKNOWN; no results are returned for the other 49.

## Evidence
`services/xstockstrat-analysis/app/services/screener.py:115`
> per_symbol = await asyncio.gather(

`services/xstockstrat-analysis/app/services/screener.py:229`
> except grpc.RpcError as e:

`services/xstockstrat-analysis/app/services/screener.py:256`
> row["signal_score"] = scoring.compute_signal_score(

## Root cause hypothesis
The concurrent fan-out (feature 176) kept the serial loop's lack of a per-symbol try/except.

## Confidence
high
