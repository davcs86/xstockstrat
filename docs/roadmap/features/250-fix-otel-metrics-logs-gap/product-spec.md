# Product Spec: fix-otel-metrics-logs-gap

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** Every telemetry module builds only a tracer provider and trace exporter; no `MeterProvider`,
`LoggerProvider`, metric reader or log exporter exists under `services/`. The UI passes empty pipelines
(`services/xstockstrat-ui/src/telemetry.ts:31-32`: `metricReaders: []`, `logRecordProcessors: []`). Nothing feeds
either backend that the provisioned alerts and dashboards read:

- **Metrics (Prometheus/Mimir).** The alert rules query `rpc_server_duration_milliseconds_count` / `_bucket`
  (`packages/otel/alerts/alert-rules.yaml:44-45`, `:88`), and the dashboards under `packages/otel/dashboards/`
  reference the same series 10 times (9 panel exprs + the `$service` variable query `service-health.json:47`).
  Nothing produces it, so the error-rate (`xstk-error-rate-high`) and p99 latency (`xstk-p99-latency-high`) alerts
  can never fire.
- **Logs (Loki).** The critical alert `xstk-analysis-no-scoring` (`alert-rules.yaml:116-134`, severity `:121`)
  queries `${DS_LOKI_UID}` (`:129`) with `count_over_time({service_name="analysis"} |~ "ScoreStrategy|RunBacktest"
  [30m])` (`:134`), and 9 of the 18 dashboard panel exprs are LogQL (`signal-pipeline-throughput.json:59,74,104,109`;
  `infrastructure.json:74,105`; `service-health.json:136`; `trading-service.json:92,107`). Nothing feeds Loki: no log
  exporter under `services/`, the collector `logs` pipeline takes OTLP only
  (`packages/otel/otel-collector-config.yaml:84-87`), and `.do/` declares no `log_destinations`. The alert and the 9
  panels evaluate against no data, so none can detect a scoring stall, error spike or pipeline failure.

`docs/setup/grafana-cloud.md:3` claims every workload "emits traces, metrics, and logs via OTLP", and `:21-24` lists
Metrics and Logs as signal types sent.

**Expected.** No provisioned alert rule, dashboard panel or variable query depends on a metric series or log stream
that nothing produces, and the setup docs state the signals actually exported. Per operator decision 2026-10-20
(narrow to traces): the alert/dashboard set and docs are narrowed to traces — alerts and panels on unproduced
signals are removed or rewritten onto trace data (Tempo, or span metrics only if the Grafana stack is shown to
generate them).

## Reproduction Steps

1. `rg 'MeterProvider|LoggerProvider|OTLPMetricExporter|otlpmetric|PeriodicExportingMetricReader' services/` → no matches.
2. Read `packages/otel/alerts/alert-rules.yaml:44-45` (queries `rpc_server_duration_milliseconds_count`).
3. In Grafana Cloud, query that metric for any `service_name` → no series.

## Root Cause Hypothesis

Feature 226 (`docs/roadmap/features/226-fix-otel-trace-export/`, launched) chose traces-only export by Operator
Decision 3 (`product-spec.md:64`). The alert rules, dashboards and setup docs predate it and were never reconciled.
Distinct root cause from the trace-export defect.

## Affected Services

- packages/otel (alerts, dashboards, collector config, `packages/otel` docs)
- docs (`docs/setup/grafana-cloud.md`, `docs/patterns/observability.md`)

No `xstockstrat-*` runtime is affected: runtime metric/log export (fix (b), `context.md`) is out of scope (see Out of Scope).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config/deploy changes anticipated (no OTLP metrics/logs exporter env; fix (b) out of scope)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Trace export (fixed by feature 226)
- Adding OTLP metric or log export to any runtime (fix (b), `context.md`): new capability that reverses feature 226
  Operator Decision 3 (`docs/roadmap/features/226-fix-otel-trace-export/product-spec.md:64`); routes to a separate
  `/sdd-story` with operator sign-off (C-11). Operator decision 2026-10-20: narrow to traces.
