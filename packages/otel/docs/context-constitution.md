# packages/otel — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped); refreshed 2026-10-30 (feature 250 teardown — OTEL-1 re-grounded on Tempo, OTEL-2 retired, collector line hints re-stamped). Captures the **non-obvious**
invariants of the OTel package (Collector config + checked-in Grafana provisioning; local-dev only —
production pushes OTLP straight to Grafana Cloud). Does not restate documented/CI-enforced rules
(see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **packages/otel** (chiefly the short-`service.name` addressing rule; the env-only
> OTLP/HTTP export rule lives in the root as PLAT-3).

## Rules (`OTEL-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **OTEL-1** | **Alert and dashboard queries address a service by its **short** `service.name` (`analysis`), NOT the container name (`xstockstrat-analysis`).** | In TraceQL a container-name filter (`resource.service.name = "xstockstrat-analysis"`) matches no span, so the panel is silently empty. | `dashboards/service-health.json#resource.service.name = "analysis"` (panel (c)) | `packages/otel/dashboards/service-health.json#resource.service.name = "analysis"` |
| **OTEL-2** | **RETIRED (feature 250)** — the alert/dashboard metric-name contract no longer exists: no alert or dashboard reads a metric series. | n/a | n/a | n/a |

## Gotchas & scars

- **Every service exports OTLP/HTTP to `:4318`, configured only by the spec env vars** — **root PLAT-3**; the `:4317` gRPC receiver serves other OTLP clients only. See the root constitution; not restated here (CF-N3).

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Grafana Cloud OTLP exporter (single endpoint, gzip, retry) via `${env:…}` | `otel-collector-config.yaml#otlphttp/grafana (~L49-63)` |
| Prod has no collector; services push OTLP direct to Grafana Cloud | `otel-collector-config.yaml#no collector deployment is needed there (~L18-19)` |
| Alert-rule cleanup and the Tempo dashboard (purpose, import, removed assets) | `alerts/README.md`, `dashboards/README.md` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
