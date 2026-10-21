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

The on-call operator who relies on these alerts and dashboards gets no page and no signal for any of these failures.

`docs/setup/grafana-cloud.md:3` claims every workload "emits traces, metrics, and logs via OTLP", and `:21-24` lists
Metrics and Logs as signal types sent.

**Expected.** No provisioned alert rule, dashboard panel or variable query depends on a metric series or log stream
that nothing produces, and the setup docs state the signals actually exported. Per operator decision 2026-10-20
(narrow to traces): the alert/dashboard set and docs are narrowed to traces — alerts and panels on unproduced
signals are removed or rewritten onto trace data (Tempo, or span metrics only if the Grafana stack is shown to
generate them).

**Operator coverage after the fix.** Removal alone makes the gap honest, not closed: `xstk-error-rate-high`,
`xstk-p99-latency-high` and the critical scoring-stall page `xstk-analysis-no-scoring` would leave those failures
undetected. `/sdd-design` records, per removed alert, either its trace-based replacement or the named follow-up
`/sdd-story` (trace-based alerting, or fix (b) metric/log export) that restores detection.

## Reproduction Steps

1. `rg 'MeterProvider|LoggerProvider|OTLPMetricExporter|otlpmetric|PeriodicExportingMetricReader' services/` → no matches.
2. Read `packages/otel/alerts/alert-rules.yaml:44-45` (queries `rpc_server_duration_milliseconds_count`).
3. In Grafana Cloud, query that metric for any `service_name` → no series.

## Root Cause Hypothesis

Feature 226 (`docs/roadmap/features/226-fix-otel-trace-export/`, launched) chose traces-only export by Operator
Decision 3 (`product-spec.md:64`). The alert rules, dashboards and setup docs predate it and were never reconciled.
Distinct root cause from the trace-export defect.

## Affected Services

- packages/otel (alerts, dashboards, `packages/otel` docs; collector config header comment only — see FR-4)
- docs (`docs/setup/grafana-cloud.md`, `docs/setup/CLAUDE.md`, `docs/patterns/observability.md`,
  `docs/launch-pdfs/product-features.md`, `docs/context-constitution-findings.md`)

No `xstockstrat-*` runtime is affected: runtime metric/log export (fix (b), `context.md`) is out of scope (see Out of Scope).

## Functional Requirements

"Produced" means exported by a runtime today (traces only, feature 226), or derived from exported traces by a
Grafana-side span-metrics path that is shown to exist for the stack (verified to return series in Grafana, not merely
documented). Today the produced set holds no PromQL metric name and no Loki log stream. If `/sdd-design` adopts a
verified span-metrics path, it names the exact metric names that path yields; those are the only additions.

- **FR-1** — No alert rule in `packages/otel/alerts/alert-rules.yaml` queries a PromQL metric series that nothing
  produces. Today `xstk-error-rate-high` and `xstk-p99-latency-high` query `rpc_server_duration_milliseconds_count` /
  `_bucket` (`:44-45`, `:88`).
- **FR-2** — No dashboard panel expr or template-variable query in `packages/otel/dashboards/*.json` references a
  PromQL metric series that nothing produces. Today: 9 panel exprs plus the `$service` variable
  (`service-health.json:47`) reference `rpc_server_duration_milliseconds_*`.
- **FR-3** — No alert rule or dashboard panel queries a Loki log stream that nothing produces. Today:
  `xstk-analysis-no-scoring` (`alert-rules.yaml:129-134`) and the 9 LogQL panel exprs listed in Problem Statement.
- **FR-4** — Every doc under `docs/` or `packages/otel/` (excluding `docs/roadmap/` and `docs/reports/`) that states
  which signals are exported, or which series or datasources the provisioned alerts and dashboards read, states only
  what is actually exported and read. Known instances (repo grep, 2026-10-20; the rule covers any other):
  - `docs/setup/grafana-cloud.md` — `:3`, `:21-24`, collector "Batches spans/metrics/logs" `:108`, the "Check Logs
    (Loki)" / "Check Metrics (Prometheus/Mimir)" verification steps `:191-208`, dashboard table `:220-223`, import
    datasources `:226`, `:233`, ad-hoc Loki query `:236-241`, alert table + `${DS_LOKI_UID}` apply step `:258-261`,
    Loki derived-fields troubleshooting `:313-319`
  - `packages/otel/alerts/README.md:25-26` (`${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}` substitution rows)
  - `docs/setup/CLAUDE.md:10` ("verify traces/metrics/logs arrive")
  - `docs/patterns/observability.md:3`
  - `docs/launch-pdfs/product-features.md:192` ("exports OTLP traces, metrics, and logs")
  - `packages/otel/dashboards/README.md` — `:4`, signals table `:7-12`, datasource inputs `:16-26`, `:30-38`,
    log-derived panels and scheduler Loki markers `:43-49`
  - `packages/otel/otel-collector-config.yaml:9` ("Exports all three signal types") — comment correction only; the
    `metrics`/`logs` pipelines (`:79-87`) are retained on purpose (feature 226 `design.md:24`, `:38`)
  - `packages/otel/CLAUDE.md:4` (constitution pointer: "`rpc_server_duration_milliseconds` metric-name contract")
  - `packages/otel/docs/context-constitution.md` OTEL-2 (`:17`) and OTEL-1 (`:16`, whose evidence cites the Loki
    alert `alert-rules.yaml:134`)
  - The findings rows `docs/context-constitution-findings.md:18` and `packages/otel/docs/context-constitution-findings.md:13`
    carry a resolution marker citing this feature.

## Consumer Surface(s)

None — internal/platform-only. The change edits operator observability assets (Grafana alert rules, dashboards) and
setup docs under `packages/otel/` and `docs/`. No UI segment (`/trader`, `/insights`, `/config-ui`) and no Agent MCP
tool changes, and no RPC, response field, computed value or stored state changes. The only observer is the operator
in Grafana.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config/deploy changes anticipated (no OTLP metrics/logs exporter env; fix (b) out of scope). The only
  collector-config edit is the `otel-collector-config.yaml:9` header comment (FR-4); no pipeline, receiver or env change.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass. No runtime changes, so verification is: the
mechanical produced-set check (defined at `/sdd-spec`) passes over `alert-rules.yaml` and `dashboards/*.json`, and the
edited alert rules and dashboards import into Grafana Cloud with no query targeting an unproduced series.
Touching `CLAUDE.md`, constitution and findings files triggers the root `CLAUDE.md` Teardown (context-forge refresh).

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Trace export (fixed by feature 226)
- Adding OTLP metric or log export to any runtime (fix (b), `context.md`): new capability that reverses feature 226
  Operator Decision 3 (`docs/roadmap/features/226-fix-otel-trace-export/product-spec.md:64`); routes to a separate
  `/sdd-story` with operator sign-off (C-11). Operator decision 2026-10-20: narrow to traces.
