# Implementation Spec: phase7-observability

**Created**: 2026-06-09
**Status**: delivered (branch `claude/phase-7-jnruyq`)

> Generated as part of the `implement phase 7` harness session rather than a standalone
> `/sdd-spec` run. Codebase discovery established that the bulk of Phase 7 (collector, per-language
> OTel stubs, DO/compose env wiring, runbook) already shipped with feature `015-fix-grafana-otel-variables`.
> The remaining work — and what these steps deliver — is verification + the missing build artifacts +
> one stub gap. Open questions from the product spec are resolved here with documented defaults.

---

## Discovery summary (what already existed)

| FR | Pre-existing? | Evidence |
|---|---|---|
| FR-1 per-service OTEL env | **Yes** | Global `envs:` block in `.do/app.yaml` / `.do/app.dev.yaml` (`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` as RUN_TIME SECRET), inherited by all components; per-service `SERVICE_NAME` + `OTEL_EXPORTER_OTLP_ENDPOINT` in `docker-compose.yml`. |
| FR-2 collector → Grafana export | **Yes** | `packages/otel/otel-collector-config.yaml` `otlphttp/grafana` exporter on traces/metrics/logs pipelines; `otel-collector` service in `docker-compose.yml`. |
| FR-5 non-fatal init | **Yes (verified)** | Go `internal/telemetry/otel.go` (slog.Warn + continue), Python `app/telemetry.py` (try/except + no-op), Node `src/telemetry.ts` (early-return + caught start), UI `instrumentation.ts` → `src/telemetry.ts`. All gate on `OTEL_ENABLED`. |
| FR-3 dashboards | **No** | `packages/otel/dashboards/` did not exist. |
| FR-4 alerts | **No** | No alert provisioning files. |
| Agent telemetry | **No** | `xstockstrat-agent` had no telemetry module (predated feature-015 sweep). |

---

## Open-question resolutions

1. **Grafana plan limits** — informational; free tier (10k series / 50 GB logs) covers dev/paper
   per `docs/setup/grafana-cloud.md`. No code impact.
2. **Dashboard provisioning** → **file-based JSON** in `packages/otel/dashboards/` (FR-3 default).
3. **Per-service vs global OTEL env injection** → **global**, already the case in the DO specs
   (each component overrides only `SERVICE_NAME`).
4. **Alert routing target** → **not pinned**; rules + mute timing shipped as files, routing left
   per-env (email / Slack via feature 020).

---

## Delivered steps

### Step 1 — Fill the agent telemetry gap ✅
- `services/xstockstrat-agent/app/telemetry.py` — mirrors the Python pattern but uses
  `GrpcAioInstrumentorClient` (agent is a `grpc.aio` client, not a server). Non-fatal, gated on
  `OTEL_ENABLED`, `SERVICE_NAME` default `agent`.
- `app/main.py` `__main__` calls `init_telemetry()` before running either transport.
- `pyproject.toml` += `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-grpc`,
  `opentelemetry-instrumentation-grpc`; `uv lock` re-run (`uv.lock` committed; protobuf resolved
  to 6.33.x, matching the other Python services).
- `docker-compose.yml`: agent block += `SERVICE_NAME: agent`, `OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317`.
- `.do/app.yaml` + `.do/app.dev.yaml`: agent block += `SERVICE_NAME: agent`.

### Step 2 — Dashboards (FR-3) ✅
`packages/otel/dashboards/` + `README.md`:
- `service-health.json` (`xstk-service-health`)
- `signal-pipeline-throughput.json` (`xstk-signal-pipeline`)
- `trading-service.json` (`xstk-trading-service`)
- `infrastructure.json` (`xstk-infrastructure`)

Built on signals that already flow: the `rpc_server_duration_milliseconds` histogram (gRPC
instrumentation) and Loki log matches. Datasources bound at import via `__inputs`
(`DS_PROMETHEUS`, `DS_LOKI`). JSON validated.

### Step 3 — Alerts (FR-4) ✅
`packages/otel/alerts/` + `README.md`:
- `alert-rules.yaml` — `xstk-error-rate-high` (>1% / 5m), `xstk-p99-latency-high` (P99 >2s / 3m),
  `xstk-analysis-no-scoring` (zero scoring events / 30m).
- `mute-timings.yaml` — `outside-us-market-hours`, attached to the no-scoring alert's policy so it
  only pages during the US session. YAML validated.

### Step 4 — Docs (FR-6) ✅
`docs/setup/grafana-cloud.md`: Steps 6/7 now point at the checked-in dashboards/alerts; intro +
prod section describe global-env inheritance; service-name table adds `agent` and corrects the UI
(`xstockstrat-ui`); stale "13 services" wording fixed.

### Step 5 — Status bookkeeping ✅
Root `CLAUDE.md` (Phase 7 → DONE; `phase[3-7]-deviations`), `implementation-roadmap.md` (Phase 7
DONE banner), `docs/roadmap/CLAUDE.md`, new `docs/roadmap/phase7-deviations.md`, this feature's
`feature.md` / `context.md`.

---

## Acceptance criteria mapping

| AC | How it's met / how to verify |
|---|---|
| AC1 metrics+logs, no startup errors | Stubs gated + non-fatal (FR-5 verified); set `OTEL_ENABLED=true` and start the stack. |
| AC2 Service Health dashboard | `service-health.json`, one series per `service_name`. |
| AC3 Signal throughput within 60s | `signal-pipeline-throughput.json` Loki `signal.ingested` panel. |
| AC4 error alert within 6 min | `xstk-error-rate-high` (`for: 5m`, 1m eval). |
| AC5 `OTEL_ENABLED=false` no traffic / no errors | Every module early-returns when disabled (compose default `false`). |
| AC6 reproducible runbook | `docs/setup/grafana-cloud.md` + `packages/otel/*/README.md`. |

---

## Out of scope (V1 → V2)

Tempo trace dashboards; bespoke business metrics (position counts, bracket-order success,
TimescaleDB pool gauges); programmatic (Terraform/API) provisioning. See `phase7-deviations.md`.
