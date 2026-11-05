# Defect: SandboxResult.memory_used_bytes is always zero

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: misleading-telemetry
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no
**Source**: services/xstockstrat-indicators/docs/context-constitution-findings.md — Open question "`SandboxResult.memory_used_bytes` is hardcoded to `0` …"

## Observed
Every return path of the sandbox hardcodes `memory_used_bytes=0`, and the servicer copies it into the
`ExecuteFormula` response. Callers (UI, agent `test_formula`) see a field that looks like a
measurement but never carries one.

## Expected
Either measure it (for example the child's `ru_maxrss` from `resource.getrusage(RUSAGE_CHILDREN)` or
the `VmData` delta) or deprecate the proto field.

## Reproduction
1. ExecuteFormula with any formula that allocates (e.g. `numpy.zeros(10_000_000)`).
2. The response shows `memory_used_bytes: 0`.

## Evidence
`services/xstockstrat-indicators/app/services/sandbox.py:387`
> memory_used_bytes=0,

`services/xstockstrat-indicators/app/services/sandbox.py:414`
> memory_used_bytes=0,

`services/xstockstrat-indicators/app/handlers/servicer.py:341`
> memory_used_bytes=result.memory_used_bytes,

## Root cause hypothesis
Memory accounting was never implemented after the field was added to the proto.

## Confidence
high
