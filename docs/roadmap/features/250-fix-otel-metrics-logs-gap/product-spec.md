# Product Spec: fix-otel-metrics-logs-gap

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** Every telemetry module builds only a tracer provider and trace exporter; no `MeterProvider`,
`LoggerProvider`, metric reader or log exporter exists under `services/`. The UI passes empty pipelines
(`services/xstockstrat-ui/src/telemetry.ts:31-32`: `metricReaders: []`, `logRecordProcessors: []`). The alert rules
query `rpc_server_duration_milliseconds_count` / `_bucket` (`packages/otel/alerts/alert-rules.yaml:44-45`, `:88`), and
the dashboards under `packages/otel/dashboards/` reference the same series (10 matches). Nothing produces it, so the
error-rate and p99 latency alerts can never fire. `docs/setup/grafana-cloud.md:3` claims every workload "emits
traces, metrics, and logs via OTLP".

**Expected.** No provisioned alert or dashboard depends on a series that nothing produces, and the setup docs state
the signals actually exported. Either (a) the alert/dashboard set and docs are narrowed to traces (or a documented
Grafana-side span-metrics path), or (b) services export the RPC histogram (and logs) the alerts depend on.

## Reproduction Steps

1. `rg 'MeterProvider|LoggerProvider|OTLPMetricExporter|otlpmetric|PeriodicExportingMetricReader' services/` → no matches.
2. Read `packages/otel/alerts/alert-rules.yaml:44-45` (queries `rpc_server_duration_milliseconds_count`).
3. In Grafana Cloud, query that metric for any `service_name` → no series.

## Root Cause Hypothesis

Feature 226 (`docs/roadmap/features/226-fix-otel-trace-export/`, launched) chose traces-only export by Operator
Decision 3 (`product-spec.md:64`). The alert rules, dashboards and setup docs predate it and were never reconciled.
Distinct root cause from the trace-export defect.

## Affected Services

- packages/otel (alerts, dashboards, collector config)
- docs (`docs/setup/grafana-cloud.md`, `docs/patterns/observability.md`)
- All 12 runtimes (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, config,
  ui, agent) — only under fix (b)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [ ] Config/deploy change possible under fix (b): OTLP metrics/logs exporter env in `.do/app*.yaml` and compose

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Trace export (fixed by feature 226)
