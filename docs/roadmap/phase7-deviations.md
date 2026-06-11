# Phase 7 — Observability — Deviation Notes

**Status: DONE** (feature `033-phase7-observability`)

Phase 7 activates the OpenTelemetry instrumentation that earlier features had already stubbed
into every service, and delivers the operational dashboards and alerts the roadmap calls for.
Because most of the SDK wiring predated this phase, Phase 7's net work was **activation +
artifacts + filling one gap**, not green-field instrumentation. This note records where the
delivered implementation diverges from the roadmap's Phase 7A–7G prose.

---

## What already existed before Phase 7 (from feature 015 — `fix-grafana-otel-variables`)

- `packages/otel/otel-collector-config.yaml` — collector receiving OTLP on gRPC `:4317` and
  HTTP `:4318`, exporting logs/metrics/traces to Grafana Cloud via `otlphttp/grafana` with the
  endpoint/headers sourced from env.
- `otel-collector` service in `docker-compose.yml`, plus `OTEL_ENABLED` / `SERVICE_NAME` /
  `OTEL_EXPORTER_OTLP_ENDPOINT` env wiring on all backend + UI service blocks.
- Per-language telemetry modules, all gated behind `OTEL_ENABLED` and non-fatal:
  - Go: `internal/telemetry/otel.go` (trading, portfolio, marketdata) + `otelgrpc` server handler.
  - Python: `app/telemetry.py` (indicators, ingest, analysis) + `GrpcAioInstrumentorServer`.
  - Node.js: `src/telemetry.ts` (config, ledger, identity, notify) + `NodeSDK` gRPC instrumentation.
  - Next.js UI: `src/telemetry.ts` invoked from `instrumentation.ts` `register()`.
- Global `OTEL_*` envs in `.do/app.yaml` / `.do/app.dev.yaml` (inherited by all components;
  `OTEL_EXPORTER_OTLP_HEADERS` as a RUN_TIME SECRET).
- `docs/setup/grafana-cloud.md` end-to-end runbook.

So FR-1 (per-service OTEL env), FR-2 (collector → Grafana export), and FR-5 (non-fatal init)
were already satisfied at phase start and were **verified**, not re-implemented.

---

## Deviations / decisions in this phase

1. **Agent telemetry gap filled (code change).** `xstockstrat-agent` was the only deployable
   workload with no telemetry module — it predated the feature-015 sweep. Added
   `services/xstockstrat-agent/app/telemetry.py`, called from `app/main.py` `__main__` before
   the transport runs. The agent is a gRPC **client** (it dials platform services over
   `grpc.aio`), so it uses `GrpcAioInstrumentorClient` rather than the server instrumentor the
   other Python services use. Added the three OTel deps to `pyproject.toml` and ran `uv lock`
   (this pulled `protobuf` from 7.x down to 6.33.x via the OTel proto constraint, bringing the
   agent **in line** with the other Python services, which already resolve protobuf 6.33.x).
   Added `SERVICE_NAME: agent` + `OTEL_EXPORTER_OTLP_ENDPOINT` to the agent's docker-compose
   block and `SERVICE_NAME: agent` to both DO app specs (the global `OTEL_*` envs are inherited).

2. **Dashboards are file-based, not UI-managed (FR-3, open-question resolution).** Resolved the
   product-spec open question in favor of checked-in JSON under `packages/otel/dashboards/`
   (`service-health`, `signal-pipeline-throughput`, `trading-service`, `infrastructure`) as the
   reproducible source of truth, with a `README.md` documenting import + metric assumptions.

3. **Dashboards built on gRPC metrics + Loki logs, not bespoke business metrics.** The roadmap
   FR-3 panel wishlist names some metrics no service currently emits (open-position gauge,
   bracket-order success counter, TimescaleDB pool-utilization gauge). Rather than ship panels
   that render "No data", those concepts are approximated from signals that **do** exist today —
   the `rpc_server_duration_milliseconds` histogram from the gRPC instrumentation and Loki log
   matches — and the README flags which panels would benefit from future custom instrumentation
   (a V2 extension, consistent with the spec's "starter dashboards" framing).

4. **Alerts as Grafana provisioning files (FR-4).** `packages/otel/alerts/alert-rules.yaml`
   implements the three required rules (error rate > 1% / 5m, P99 > 2s / 3m, analysis no-scoring
   / 30m). The "during market hours" qualifier on the no-scoring alert is implemented as a
   **notification mute timing** (`mute-timings.yaml`, `outside-us-market-hours`) attached to the
   policy rather than baked into the rule expression — the rule evaluates 24/7 (visible on
   dashboards); only paging is suppressed off-hours. Datasource UIDs are placeholders
   (`${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}`) substituted per environment.

5. **Notification routing intentionally not pinned (open-question resolution).** Contact points
   and policies are left to each environment; V1 routes to email or Slack via feature
   `020-notify-external-fanout`. Grafana OnCall / PagerDuty remain out of scope per the spec.

6. **No new config-service keys.** Per the product spec, OTLP endpoint/credentials stay
   infrastructure env/secrets, not `xstockstrat-config` keys — superseding the older
   `platform.otel.*` key table in the roadmap's Phase 7 prose, which is not implemented.

7. **Docs accuracy fixes (FR-6).** `docs/setup/grafana-cloud.md` updated to point at the
   checked-in dashboards/alerts, to describe the global-env inheritance model, to add
   `xstockstrat-agent` to the service-name reference, and to correct the UI's `service.name`
   (`xstockstrat-ui`, matching `SERVICE_NAME` in the specs) and the stale "13 services" count.

---

## Not done in V1 (deferred)

- Distributed-trace **dashboards** (Tempo views) — traces are collected; visualization is V2.
- Custom business metrics (position counts, bracket success, DB pool gauges) — V2.
- Live programmatic provisioning (Terraform/Grafana API) — files are import-ready; automated
  provisioning wiring is left to the platform lead.
