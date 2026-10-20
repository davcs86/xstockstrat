# Defect: No service exports OTel metrics or logs, so the Grafana alerts and dashboards read nothing

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: silent-telemetry-loss
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: all 12 runtimes (xstockstrat-trading, -portfolio, -marketdata, -indicators, -ingest, -analysis, -ledger, -identity, -notify, -config, -ui, -agent); packages/otel
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Documentation that lies row 2; `packages/otel/docs/context-constitution-findings.md` § Open questions ("Latent bug?" RPC histogram); `packages/otel/docs/context-constitution.md` OTEL-2

## Observed
Every telemetry module builds only a tracer provider + trace exporter. No `MeterProvider`,
`LoggerProvider`, metric reader or log exporter exists in `services/`; the UI explicitly passes empty
metric/log pipelines. The provisioned alert rules and dashboards query the OTLP→Prometheus histogram
`rpc_server_duration_milliseconds`, which nothing produces, so the error-rate and p99 latency alerts
can never fire. `docs/setup/grafana-cloud.md` claims every workload emits traces, metrics and logs.

## Expected
Either services export the RPC histogram (and logs) the alerts depend on, or the docs and
alert/dashboard set are narrowed to traces (or a Grafana-side span-metrics path is documented).

## Reproduction
1. `rg 'MeterProvider|LoggerProvider|OTLPMetricExporter|otlpmetric|PeriodicExportingMetricReader' services/` → no matches.
2. Read `packages/otel/alerts/alert-rules.yaml:44-45` (queries `rpc_server_duration_milliseconds_count`).
3. In Grafana Cloud, query that metric for any `service_name` → no series.

## Evidence
`services/xstockstrat-ui/src/telemetry.ts:31-32`
> metricReaders: [],
> logRecordProcessors: [],

`packages/otel/alerts/alert-rules.yaml:44`
> 100 * sum by (service_name) (rate(rpc_server_duration_milliseconds_count{rpc_grpc_status_code!="0"}[5m]))

`packages/otel/alerts/alert-rules.yaml:88`
> histogram_quantile(0.99, sum by (le, service_name) (rate(rpc_server_duration_milliseconds_bucket[5m])))

`docs/setup/grafana-cloud.md:3`
> emits traces, metrics, and logs via OTLP

## Root cause hypothesis
Feature 226 settled on traces-only export by operator decision; the alert rules, dashboards and setup
docs predate that and were never reconciled. Distinct root cause from the trace-export report.

## Confidence
high
