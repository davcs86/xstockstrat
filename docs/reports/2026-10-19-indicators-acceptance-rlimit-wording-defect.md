# Defect: Sandbox OS-isolation acceptance suite says "address-space" for the RLIMIT_DATA cap

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no
**Source**: services/xstockstrat-indicators/docs/context-constitution-findings.md — Open question "Wording drift"; constitution INDICATORS-2

## Observed
The durable acceptance suite says the allocation is terminated at its "address-space" RLIMIT. The
sandbox deliberately caps `RLIMIT_DATA` (data segment) and never uses `RLIMIT_AS` (INDICATORS-2). A
reader or test author trusting the suite would reintroduce `RLIMIT_AS`, which rejects numpy/pandas on
import.

## Expected
The scenario names the data-segment (`RLIMIT_DATA`) limit. Constitution C-16 forbids hand-editing a
durable per-service suite, so the wording change must ship through a superseding feature whose
`acceptance.feature` is promoted at launch.

## Reproduction
1. Read `acceptance/indicators-sandbox-os-isolation.feature:29`.
2. Compare with `app/services/sandbox.py:284`.

## Evidence
`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:29`
> Then each is terminated at its RLIMIT (wall-clock / CPU for the loop, address-space for the allocation)

`services/xstockstrat-indicators/app/services/sandbox.py:284`
> resource.setrlimit(resource.RLIMIT_DATA, (_cap, _cap))

## Root cause hypothesis
The suite was written before the RLIMIT_AS → RLIMIT_DATA switch and was never superseded.

## Confidence
high
