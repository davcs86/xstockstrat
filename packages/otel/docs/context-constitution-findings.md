# packages/otel — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — +1 doc-lie (OTLP headers comment), +1 open question (RPC histogram never exported); hints re-stamped). For triage/fixing, not
governance. The `observability.md` doc-lie about the OTLP port is recorded at the root (cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

- `otel-collector-config.yaml#OTEL_EXPORTER_OTLP_HEADERS must be the Authorization header VALUE only (~L13-15)` gives two conflicting instructions: the value is `Basic <base64(instanceId:apiKey)>`, then "copy the part after 'Basic '" (the exporter at `#Authorization: "${env:OTEL_EXPORTER_OTLP_HEADERS}" (~L55)` sends the env value verbatim, so the `Basic ` prefix is required). Action: reword the comment. (found 2026-10-19) — status: **open**

## Open questions (unresolved *why* — needs a maintainer)

- `memory_limiter.limit_mib: 256` / `spike_limit_mib: 64` / `batch.timeout: 10s` are dev-tuned magic numbers with no prod counterpart — deliberately dev-only (collector absent in prod), or placeholders? `otel-collector-config.yaml#memory_limiter (~L36-45)` — status: **open**
- ~~**Latent bug?** alerts and dashboards depended on an RPC duration histogram no service exports~~ **NARROWED (feature 250)** — defect `otel-metrics-logs-never-exported-defect`: alerts/dashboards narrowed to traces, docs corrected; metrics/logs export is `docs/roadmap/features/274-otel-metrics-logs-export/`. — status: **narrowed**

## Resolved

- **`alerts/README.md` implies `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}` placeholders resolve automatically** — retired 2026-08-09 (refresh): this row misdiagnosed its own evidence. `alerts/README.md:19-29` ("## Substitutions before provisioning") already explicitly instructs "replace them before applying" with a table of what to substitute; `docs/setup/grafana-cloud.md#**Apply:** substitute (~L261-264)` is equally explicit. No `envsubst`/templating tooling was ever implied or expected. Confirmed no such tooling exists (repo-wide grep for `DS_PROMETHEUS_UID|DS_LOKI_UID|envsubst`, only doc references). Not a real doc-lie — dropped. The placeholders were later removed with the alert rules (feature 250, defect `otel-metrics-logs-never-exported-defect`).
- **No service exports OTel metrics or logs, so the Grafana alerts and dashboards read nothing** — resolved by feature 250 (alerts/dashboards narrowed to traces, docs corrected); report [`2026-10-19-otel-metrics-logs-never-exported-defect`](../../../docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md); export restoration is `docs/roadmap/features/274-otel-metrics-logs-export/`.


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-otel-collector-headers-comment-contradiction-defect`](../../../docs/reports/2026-10-19-otel-collector-headers-comment-contradiction-defect.md) | otel-collector config comment gives contradictory instructions for OTEL_EXPORTER_OTLP_HEADERS |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
