# Defect: observability.md advertises a phantom live OTel switch and points at an outdated roadmap section

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: docs (all services' OTel setup)
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Documentation that lies rows 3 (`platform.otel.enabled`) and 6 (roadmap Phase 7)

## Observed
1. `docs/patterns/observability.md` says config key `platform.otel.enabled` is a live switch without
   restart. No code reads that key; every service gates once at init on the `OTEL_ENABLED` env var.
2. The same doc sends readers to Phase 7 of `docs/roadmap/implementation-roadmap.md` for
   per-language patterns. That section still documents gRPC `otel-collector:4317` and
   `--otlp-insecure`, contradicting the current env-only OTLP/HTTP `:4318` contract (PLAT-3, feature 226).

## Expected
Drop (or implement) the `platform.otel.enabled` claim; drop the Phase 7 pointer or mark that
roadmap section as historical.

## Reproduction
1. `grep -rn 'platform\.otel' services` → no matches; compare with `observability.md:7`.
2. Read `observability.md:31`, then `implementation-roadmap.md:617,648,660`; compare with `observability.md:5`.

## Evidence
`docs/patterns/observability.md:7`
> - **Toggle**: `OTEL_ENABLED=true` env var on each service. Config key `platform.otel.enabled` provides a live switch without restart.

`docs/patterns/observability.md:31`
> See Phase 7 in `docs/roadmap/implementation-roadmap.md` for per-language implementation patterns.

`docs/roadmap/implementation-roadmap.md:617`
> push OTLP to `otel-collector:4317`.

`docs/roadmap/implementation-roadmap.md:660`
> traces --otlp-endpoint otel-collector:4317 --otlp-insecure --duration 5s

## Root cause hypothesis
The live switch was planned but never built; feature 226 rewrote the exporter contract without
revisiting the roadmap section the pattern doc still links to.

## Confidence
high
