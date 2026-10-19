# Defect: Sandbox exit reason is classified by stderr substring match

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: misclassification
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no
**Source**: services/xstockstrat-indicators/docs/context-constitution-findings.md — Open question "Sandbox failure classification greps child stderr …"; constitution Candidate rules row 1

## Observed
A failed sandbox run is tagged `import_blocked` when stderr contains "is not allowed in sandbox", and
`memory_exceeded` when it contains "MemoryError" or the OpenBLAS marker. A formula that raises an
exception carrying either string, for example `raise ValueError("is not allowed in sandbox")`, is
mis-tagged. Only the caller's own run is affected.

## Expected
The child wrapper reports the failure class structurally (a distinct exit code or a sentinel the
formula cannot forge).

## Reproduction
1. ExecuteFormula with source `raise ValueError("is not allowed in sandbox")`.
2. Observe exit_reason `import_blocked` instead of `runtime_error`.

## Evidence
`services/xstockstrat-indicators/app/services/sandbox.py:201`
> _MEMORY_EXHAUSTED_MARKERS = ("MemoryError", "OpenBLAS error: Memory allocation still failed")

`services/xstockstrat-indicators/app/services/sandbox.py:404`
> if "is not allowed in sandbox" in stderr:

`services/xstockstrat-indicators/app/services/sandbox.py:406`
> elif any(m in stderr for m in _MEMORY_EXHAUSTED_MARKERS):

## Root cause hypothesis
String matching was the simplest discriminator. No maintainer has ruled on whether it is a fixed contract.

## Confidence
high
