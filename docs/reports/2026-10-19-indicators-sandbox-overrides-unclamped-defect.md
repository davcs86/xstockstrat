# Defect: ExecuteFormula timeout/memory overrides are unclamped (sandbox slot exhaustion)

**Recorded**: 2026-10-19
**Severity**: SEV-1
**Impact type**: sandbox-dos
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-indicators, xstockstrat-agent
**Config-only fix possible**: no
**Source**: services/xstockstrat-indicators/docs/context-constitution-findings.md — Open questions "Unclamped override" and "Is `timeout_ms_override` … meant to be unbounded"

## Observed
`ExecuteFormula` replaces the configured sandbox timeout/memory with the request's
`timeout_ms_override` / `memory_bytes_override` with no clamp. Any authenticated caller can do this,
including through the MCP `test_formula` tool. `RLIMIT_CPU` is derived from the override, so
`while True: pass` runs for the full override (int32 ms ≈ 24 days) while holding one of the
`indicators.sandbox.max_concurrent` (default 4) slots. Four such calls block every ExecuteFormula
platform-wide: backtests, the live loop, the screener and fundsignal scoring. A negative
`memory_bytes_override` skips `RLIMIT_DATA` entirely.

## Expected
Overrides are clamped to at most the configured value (or a fixed ceiling), and non-positive memory
overrides are rejected or ignored.

## Reproduction
1. Call MCP `test_formula(source="while True: pass", timeout_ms=2000000000)` four times concurrently.
2. Issue any other ExecuteFormula (for example a backtest using a custom formula).
3. It blocks on `_sandbox_sem` until one of the busy children exits.

## Evidence
`services/xstockstrat-indicators/app/handlers/servicer.py:277-278`
> timeout_ms = request.timeout_ms_override or self._cfg.sandbox_timeout_ms
> memory_bytes = request.memory_bytes_override or self._cfg.sandbox_memory_bytes

`services/xstockstrat-indicators/app/handlers/servicer.py:294`
> async with self._sandbox_sem:

`services/xstockstrat-indicators/app/services/sandbox.py:345`
> rlimit_cpu = math.ceil(timeout_ms / 1000) + 2

`services/xstockstrat-indicators/app/services/sandbox.py:282`
> if {memory_bytes} > 0:

`services/xstockstrat-agent/app/tools.py:1494`
> timeout_ms_override=timeout_ms,

## Root cause hypothesis
The proto override fields (`indicators.proto:80-81`, "0 = use config value") are passed straight
through. No upper bound and no sign check is applied before they set the rlimits and the
`communicate(timeout=…)` deadline.

## Confidence
high
