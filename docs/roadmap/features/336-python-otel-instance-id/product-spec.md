# Product Spec: python-otel-instance-id

**Created**: 2026-11-12

---

## Problem Statement

Go, Node and UI services export `service.instance.id = <host.provider>-<service.name>`, but the four Python services (analysis, ingest, indicators, agent) keep an SDK-generated random id. Live Grafana data shows the four homelab Python services under UUID instances (`7ef0591e-…` analysis, `e08d49a3-…` ingest, `ce83cd93-…` indicators, `f1a73349-…` agent), so a `service_instance_id=~"homelab-.+"` selector in Loki misses 4 of 12 homelab services, and each Python restart creates a new series. Operators filtering by provider must fall back to a pipeline filter (`| host_provider="homelab"`) for logs.

## User Story

As a platform operator, I want every service on a given host provider to carry the same `<host.provider>-<service.name>` instance-id shape, so that I can select a provider's streams and series by one indexed label and Python series stop churning on restart.

## Functional Requirements

FR-1. Each Python service (analysis, ingest, indicators, agent) exports `service.instance.id = <host.provider>-<service.name>` on its resource for traces, metrics and logs, matching the Go, Node and UI services.
FR-2. When `HOST_PROVIDER` is unset or not exactly `digitalocean` or `homelab`, the id uses provider `unknown` (`unknown-<service.name>`) and the service still starts.
FR-3. The id is identical across process restarts of the same service on the same provider.
FR-4. This feature supersedes feature 332 decision D-7 and scenario `@AC-21` for Python: the four Python `tests/test_telemetry.py` files assert the new id, and `docs/patterns/observability.md` states that all 12 services use `<host.provider>-<service.name>`.
FR-5. The documented post-deploy check and the Loki selector `{service_instance_id=~"homelab-.+"}` cover all 12 homelab services, not 8.

## Out of Scope

- A per-instance suffix on the id (container id or random). Evaluated and dropped (see `context.md`): the value is marginal while each service runs one replica per stack, and trace/span ids are request-scoped, not instance-scoped.
- Using `service.namespace` or any other repurposed resource attribute to carry the provider (rejected here and in feature 332 `R-6`).
- Promoting `host.provider` to a Loki index label or any Grafana Cloud stack setting (not available on the current tier).
- Changing the documented log filter: `| host_provider="homelab"` stays the canonical pipeline filter.
- Provider-scoped alerts (follow-up feature `otel-env-provider-scoped-alerts` from 332).
- Go, Node and UI runtimes (already conform; `xstockstrat-ui` was re-checked for this spec).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — Python telemetry resource builder (`app/telemetry.py`)
- `xstockstrat-ingest` — Python telemetry resource builder
- `xstockstrat-indicators` — Python telemetry resource builder
- `xstockstrat-agent` — Python telemetry resource builder

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none
- [ ] **Agent** — none
- [x] **None** — internal/platform-only. The id is a telemetry resource attribute consumed by operators through Grafana (Loki, Mimir, Tempo) and by `scripts/check-otel-produced-signals.py`; no UI segment or MCP tool changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. `HOST_PROVIDER` and `SERVICE_NAME` are existing startup env vars (feature 332), not config-service keys.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/python-otel-instance-id` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, no proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Single process per service?** A fixed id makes two processes in one service export identical `(job, instance, deployment_environment)` series. This is the same accepted risk Go, Node and UI already carry (332 D-7: one replica per service per stack; `observability.md:111` rolling-deploy overlap). Recon must prove each Python entrypoint runs exactly one exporting process on DO and homelab (no multi-worker uvicorn/gunicorn, no forked children). If any runs N>1, FR-1 cannot ship for it as written.
- [ ] **Where does the Python `service.instance.id` come from today?** Feature 332 left this unverified. Per Ledger `fails.md` (feature 274 rule: read the pinned library's actual resolution path before claiming behavior), recon must read the pinned `opentelemetry-sdk` `Resource.create` path and its `OTEL_RESOURCE_ATTRIBUTES` / detector interaction, not assume.
- [ ] **Existing series on cutover.** The first deploy relabels the Python series on DO dev and homelab once (old UUID-instance series go stale). Recon should confirm no dashboard, alert or recording rule keys on a Python `instance` value (current evidence: `packages/otel/` keys on `service_name`, never `job` or `instance`).
- [ ] **Known trap (Ledger):** feature 332 shipped with `service.instance.id` documented per runtime, but its Python source was unverified. Do not repeat; ground FR-1 on a wire-level test of the exported resource for each of the four services.
