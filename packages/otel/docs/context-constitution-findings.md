# packages/otel — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — +1 doc-lie (OTLP headers comment), +1 open question (RPC histogram never exported); hints re-stamped). For triage/fixing, not
governance. The `observability.md` doc-lie about the OTLP port is recorded at the root (cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

- `otel-collector-config.yaml#OTEL_EXPORTER_OTLP_HEADERS must be the Authorization header VALUE only (~L13-15)` gives two conflicting instructions: the value is `Basic <base64(instanceId:apiKey)>`, then "copy the part after 'Basic '" (the exporter at `#Authorization: "${env:OTEL_EXPORTER_OTLP_HEADERS}" (~L55)` sends the env value verbatim, so the `Basic ` prefix is required). Action: reword the comment. (found 2026-10-19) — status: **open**

## Open questions (unresolved *why* — needs a maintainer)

- `memory_limiter.limit_mib: 256` / `spike_limit_mib: 64` / `batch.timeout: 10s` are dev-tuned magic numbers with no prod counterpart — deliberately dev-only (collector absent in prod), or placeholders? `otel-collector-config.yaml#memory_limiter (~L36-45)` — status: **open**
- **Latent bug?** Alerts and dashboards query `rpc_server_duration_milliseconds`, but no service exports metrics — `rg 'MeterProvider|OTLPMetricExporter|otlpmetric|PeriodicExportingMetricReader' services/` is empty and `services/xstockstrat-ui/src/telemetry.ts#metricReaders: [] (~L31)` — so `alerts/alert-rules.yaml#rpc_server_duration_milliseconds_count (~L44-45)` may silently never fire. Is there a metric path we're missing (e.g. Grafana span-metrics)? Action: confirm the metric path, or add metric export / retire the alerts. (found 2026-10-19) — status: **open**

## Resolved

- **`alerts/README.md` implies `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}` placeholders resolve automatically** — retired 2026-08-09 (refresh): this row misdiagnosed its own evidence. `alerts/README.md:19-29` ("## Substitutions before provisioning") already explicitly instructs "replace them before applying" with a table of what to substitute; `docs/setup/grafana-cloud.md#**Apply:** substitute (~L261-264)` is equally explicit. No `envsubst`/templating tooling was ever implied or expected. Confirmed no such tooling exists (repo-wide grep for `DS_PROMETHEUS_UID|DS_LOKI_UID|envsubst`, only doc references). Not a real doc-lie — dropped.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
