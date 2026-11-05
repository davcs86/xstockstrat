# Defect: Telemetry startup log prints the raw OTLP endpoint env var (undefined/None when unset)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: misleading-diagnostics
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify, xstockstrat-ui, xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-agent
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Latent bugs row "Telemetry startup logs print the raw endpoint env var"

## Observed
Since feature 226 the exporters take no endpoint argument and resolve it from the OTel spec env
vars (falling back to the SDK default). The startup log line, however, still prints the raw
`OTEL_EXPORTER_OTLP_ENDPOINT` value, so with it unset the log reads `→ undefined` (Node) or
`endpoint: None` (Python) while the SDK actually exports to `http://localhost:4318`. The UI
`CLAUDE.md` env block lists `OTEL_EXPORTER_OTLP_ENDPOINT` with no note that it is required when
`OTEL_ENABLED` is on, so the unset case is easy to hit.

## Expected
Log the effective endpoint (or "SDK default" when unset), and document the variable as required
when `OTEL_ENABLED=true`.

## Reproduction
1. Set `OTEL_ENABLED=true`, leave `OTEL_EXPORTER_OTLP_ENDPOINT` unset.
2. Start `xstockstrat-ui` (or any Node/Python service).
3. Read the startup log: `[otel] tracing enabled → undefined (service=…)`.

## Evidence
`services/xstockstrat-ui/src/telemetry.ts:14`
> const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

`services/xstockstrat-ui/src/telemetry.ts:29`
> traceExporter: new OTLPTraceExporter(),

`services/xstockstrat-ui/src/telemetry.ts:37`
> console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

`services/xstockstrat-config/src/telemetry.ts:55` (same in identity:56, ledger:56, notify:57)
> console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

`services/xstockstrat-analysis/app/telemetry.py:51` (same in indicators:51, ingest:51, agent:55)
> log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})

`services/xstockstrat-ui/CLAUDE.md:299`
> OTEL_EXPORTER_OTLP_ENDPOINT

## Root cause hypothesis
The log line survived from the pre-226 code where `endpoint` was passed to the exporter; feature 226
removed the argument but kept the variable for logging only.

## Confidence
high
