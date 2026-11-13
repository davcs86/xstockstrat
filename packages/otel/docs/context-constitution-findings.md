# packages/otel — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — +1 doc-lie (OTLP headers comment), +1 open question (RPC histogram never exported); hints re-stamped); refreshed 2026-10-30 (feature 250 teardown — export-gap rows narrowed or resolved, collector hints re-stamped); re-verified 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — both open rows still reproduce: the contradictory `OTEL_EXPORTER_OTLP_HEADERS` comment is unchanged at `otel-collector-config.yaml` ~L13-15, and `memory_limiter` is still 256/64 MiB); refreshed 2026-11-10 (branch `main-dev` @ `3b0fa6ab` — the `OTEL_EXPORTER_OTLP_HEADERS` comment row resolved; `memory_limiter` hint re-stamped). For triage/fixing, not
governance. The `observability.md` doc-lie about the OTLP port is recorded at the root (cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

_None open (the `OTEL_EXPORTER_OTLP_HEADERS` comment row moved to Resolved 2026-11-10)._

## Open questions (unresolved *why* — needs a maintainer)

- `memory_limiter.limit_mib: 256` / `spike_limit_mib: 64` / `batch.timeout: 10s` are dev-tuned magic numbers with no prod counterpart — deliberately dev-only (collector absent in prod), or placeholders? `otel-collector-config.yaml#memory_limiter (~L36-45)` — status: **open**

## Resolved

- **`alerts/README.md` implies `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}` placeholders resolve automatically** — retired 2026-08-09 (refresh): this row misdiagnosed its own evidence. `alerts/README.md:19-29` ("## Substitutions before provisioning") already explicitly instructs "replace them before applying" with a table of what to substitute; `docs/setup/grafana-cloud.md#**Apply:** substitute (~L261-264)` is equally explicit. No `envsubst`/templating tooling was ever implied or expected. Confirmed no such tooling exists (repo-wide grep for `DS_PROMETHEUS_UID|DS_LOKI_UID|envsubst`, only doc references). Not a real doc-lie — dropped. The placeholders were later removed with the alert rules (feature 250, defect `otel-metrics-logs-never-exported-defect`).
- **No service exports OTel metrics or logs, so the Grafana alerts and dashboards read nothing** — resolved by feature 250 (alerts/dashboards narrowed to traces, docs corrected) and **RESOLVED (feature 274)**: export restored in all 12 runtimes and the assets restored on the proven series; report `2026-10-19-otel-metrics-logs-never-exported-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md); `docs/roadmap/features/274-otel-metrics-logs-export/`.
- **`OTEL_EXPORTER_OTLP_HEADERS` comment gave contradictory instructions** (`Basic <base64>` vs "copy the part after 'Basic '") — **resolved 2026-11-10**: the comment now says the value is `Basic <base64(instanceId:apiKey)>` "including the \"Basic \" prefix — it is sent verbatim" (`otel-collector-config.yaml#OTEL_EXPORTER_OTLP_HEADERS must be the Authorization header VALUE only (~L13-15)`, matching `#Authorization: "${env:OTEL_EXPORTER_OTLP_HEADERS}" (~L55)`); fixed by commit `adf411c3`, report `2026-10-19-otel-collector-headers-comment-contradiction-defect` pruned (`git show adf411c3:docs/reports/2026-10-19-otel-collector-headers-comment-contradiction-defect.md`).

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
