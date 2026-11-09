# Defect: otel-collector config comment gives contradictory instructions for OTEL_EXPORTER_OTLP_HEADERS

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: packages/otel (local otel-collector)
**Config-only fix possible**: no
**Source**: `packages/otel/docs/context-constitution-findings.md` § Documentation that lies row 1

## Observed
The header comment says the env value is `Basic <base64(instanceId:apiKey)>`, then says "copy the
part after 'Basic '". The exporter injects the env value verbatim as the `Authorization` header, so
following the second instruction drops the scheme and Grafana Cloud rejects the export (401).

## Expected
One instruction: the env value must be the full header value including the `Basic ` prefix.

## Reproduction
1. Read `packages/otel/otel-collector-config.yaml:13-15`.
2. Compare with `:55` (value sent verbatim).
3. Set `OTEL_EXPORTER_OTLP_HEADERS` to only the base64 part, run the collector against Grafana Cloud → export failures.

## Evidence
`packages/otel/otel-collector-config.yaml:13-15`
> # OTEL_EXPORTER_OTLP_HEADERS must be the Authorization header VALUE only:
> #   Basic <base64(instanceId:apiKey)>
> # (Grafana Cloud provides the pre-encoded string — copy the part after "Basic ".)

`packages/otel/otel-collector-config.yaml:55`
> Authorization: "${env:OTEL_EXPORTER_OTLP_HEADERS}"

## Root cause hypothesis
The parenthetical was meant to describe copying the base64 string from Grafana's UI into the
`Basic ` template, but reads as an instruction to strip the prefix.

## Confidence
high
