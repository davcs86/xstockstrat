# Product Spec: python-otel-instance-id

**Created**: 2026-11-12
**Revised**: 2026-11-12 — scope widened from the 4 Python runtimes to all 12, and a 6-hex suffix added (operator decision, see `context.md`). The slug still says "python"; it is kept so the reserved number and branch name do not churn.

---

## Problem Statement

Go, Node and UI services export `service.instance.id = <host.provider>-<service.name>`, but the four Python services (analysis, ingest, indicators, agent) keep an SDK-generated random id. Live Grafana data shows the four homelab Python services under UUID instances (`7ef0591e-…` analysis, `e08d49a3-…` ingest, `ce83cd93-…` indicators, `f1a73349-…` agent), so a `service_instance_id=~"homelab-.+"` selector misses 4 of 12 homelab services and each Python restart creates a new series. The deterministic Go/Node/UI id has the opposite flaw: two replicas of one service export identical `(job, instance, deployment_environment)` series (feature 332 documents this for DO rolling deploys, `observability.md:111`).

## User Story

As a platform operator, I want every service on a host provider to carry one `<host.provider>-<service.name>-<suffix6>` instance id, so that I can select a provider's streams and series by prefix and replicas of one service never collide.

## Functional Requirements

FR-1. All 12 runtimes (Go: trading, portfolio, marketdata; Node: ledger, identity, notify, config; UI; Python: analysis, ingest, indicators, agent) export `service.instance.id = <host.provider>-<service.name>-<suffix6>` on the resource of traces, metrics and logs.
FR-2. When `HOST_PROVIDER` is unset or not exactly `digitalocean` or `homelab`, the provider part is `unknown` and the service still starts.
FR-3. `<suffix6>` is the first 6 characters of the OS hostname when that hostname is exactly 12 or 64 lowercase hex characters (a Docker container id); otherwise it is 6 random lowercase hex characters generated once per process. The OS hostname is read with the language's own call (`os.Hostname()`, `socket.gethostname()`, `os.hostname()`), not the `HOSTNAME` env var, because the homelab compose sets the UI's `HOSTNAME` to `0.0.0.0`.
FR-4. Within one container the id is identical across process restarts; two containers of the same service on the same provider get distinct ids.
FR-5. This feature supersedes feature 332 decision D-7, scenario `@AC-21`, and every 332 assertion of the exact id `homelab-<service>`: the telemetry tests of all 12 services assert the new pattern.
FR-6. `docs/patterns/observability.md` states the one id shape, the suffix rule and that a container recreate starts a new series; its post-deploy check uses `instance=~"homelab-.+"` and counts 12 jobs.
FR-7. The documented PromQL post-deploy check and the Loki selector `{service_instance_id=~"homelab-.+"}` cover all 12 homelab services.

## Out of Scope

- Using `service.namespace` or any other repurposed resource attribute to carry the provider (rejected here and in feature 332 `R-6`).
- Promoting `host.provider` to a Loki index label or any Grafana Cloud stack setting (not available on the current tier).
- Changing the documented log filter: `| host_provider="homelab"` stays the canonical pipeline filter.
- Provider-scoped alerts (follow-up feature `otel-env-provider-scoped-alerts` from 332).
- Making two processes inside one container distinct (they share the container id); recon must show this does not occur.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` — Go resource builders (`internal/telemetry/`)
- `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config` — Node `buildResource` (`src/telemetry.ts`)
- `xstockstrat-ui` — Next.js `initTelemetry` (`src/telemetry.ts`)
- `xstockstrat-analysis`, `xstockstrat-ingest`, `xstockstrat-indicators`, `xstockstrat-agent` — Python `app/telemetry.py`

Also touched: `scripts/check-otel-produced-signals.py` and its tests, `docs/patterns/observability.md`, and the 332 durable scenarios that assert the old id (promoted per C-16 at launch).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none
- [ ] **Agent** — none
- [x] **None** — internal/platform-only. The id is a telemetry resource attribute consumed by operators through Grafana (Loki, Mimir, Tempo) and by the produced-signals check; no UI segment or MCP tool changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. `HOST_PROVIDER` and `SERVICE_NAME` are existing startup env vars (feature 332), not config-service keys.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/python-otel-instance-id` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval per affected service (non-breaking, no proto or config change); Platform Lead for the cross-service identity change
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Series churn trade-off (accepted by the operator, record the numbers).** A container recreate (any deploy) now starts a new series per service, and an environment whose hostname is not a hex container id (probably DO App Platform, unverified) gets a random suffix and churns on every restart. This reverses 332's "zero restart churn" for Go, Node and UI. Recon should measure active-series growth and confirm the 332 series budget (~1,200 per stack) still holds.
- [ ] **What is the hostname on DO App Platform and in the homelab containers?** Recon must read the real values (e.g. `socket.gethostname()` / `os.Hostname()` output) rather than assume Docker's 12-hex id; `deploy/homelab/compose.yml` and `docker-compose.yml` set no `hostname:`.
- [ ] **Single process per container?** Two processes in one container share the container id and would export identical series. Recon must prove each of the 12 entrypoints runs one exporting process (a shallow grep found no workers/gunicorn in the four Python services, not proof).
- [ ] **Source of Python's current `service.instance.id`.** Feature 332 left it unverified. Per Ledger `fails.md` (feature 274 rule: read the pinned library's actual resolution path before claiming behavior), recon must read the pinned `opentelemetry-sdk` `Resource.create` path and its `OTEL_RESOURCE_ATTRIBUTES` / detector interaction.
- [ ] **Series consumers.** Recon must confirm nothing keys on an exact `instance` value. Current evidence: `packages/otel/` keys on `service_name`, never `job` or `instance`; `scripts/check-otel-produced-signals.py:50-51` joins `target_info` on `(job, instance, deployment_environment)`, which stays correct because both sides carry the same id.
- [ ] **Slug.** The slug `python-otel-instance-id` no longer matches the 12-runtime scope. Rename before `/sdd-spec` if wanted (the number stays `336`).
- [ ] **Known trap (Ledger):** feature 332 shipped with the Python id source unverified. Ground FR-1 on a wire-level test of the exported resource for each runtime.
