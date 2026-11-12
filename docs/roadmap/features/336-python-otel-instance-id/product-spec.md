# Product Spec: python-otel-instance-id

**Created**: 2026-11-12

---

## Problem Statement

Go, Node and UI services export `service.instance.id = <host.provider>-<service.name>`, but the four Python services (analysis, ingest, indicators, agent) keep an SDK-generated random id. Live Grafana data shows the four homelab Python services under UUID instances (`7ef0591e-…` analysis, `e08d49a3-…` ingest, `ce83cd93-…` indicators, `f1a73349-…` agent), so a `service_instance_id=~"homelab-.+"` selector in Loki misses 4 of 12 homelab services, and each Python restart creates a new series. Operators filtering by provider must fall back to a pipeline filter (`| host_provider="homelab"`) for logs.

## User Story

As a platform operator, I want every service on a given host provider to carry the same `<host.provider>-<service.name>` instance-id shape, so that I can select a provider's streams and series by one indexed label and Python series stop churning on restart.

## Functional Requirements

FR-1. Each Python service (analysis, ingest, indicators, agent) exports `service.instance.id = <host.provider>-<service.name>` on its resource for traces, metrics and logs, matching the Go, Node and UI services.
FR-2. When `HOST_PROVIDER` is unset or not exactly `digitalocean` or `homelab`, the id uses provider `unknown` (`unknown-<service.name>`), `host.provider` stays `unknown`, and the service still starts.
FR-3. The id is identical across process restarts of the same service on the same provider.
FR-4. This feature supersedes feature 332 decision D-7 and scenario `@AC-21` for Python. The four Python `tests/test_telemetry.py` files assert the new id, and `docs/patterns/observability.md` is edited in three places, located by text because line numbers drift: the resource-attribute paragraph (drop "Python keeps its SDK-generated id"), the "Open risks" list (drop "Python restart churn (its instance id changes per process)"; the relabel-once risk covers the Python series too) and the post-deploy `instance` bullet (`homelab-<job>` for all 12 jobs, not 8).
FR-5. The doc's post-deploy check keeps its existing `host_provider="homelab"` count (at least 11 jobs idle, 12 after one UI login) and gains an equivalent count by `instance=~"homelab-.+"` with the same thresholds; the Loki selector `{service_instance_id=~"homelab-.+"}` is documented as covering all 12 services; and the produced-signals guard (`scripts/check-otel-produced-signals.py` with its pytest) still passes.

## Out of Scope

- A per-instance suffix on the id (container id or random). Evaluated and dropped (see `context.md`): the value is marginal while each service runs one replica per stack, and trace/span ids are request-scoped, not instance-scoped.
- Using `service.namespace` or any other repurposed resource attribute to carry the provider (rejected here and in feature 332 `R-6`).
- Promoting `host.provider` to a Loki index label or any Grafana Cloud stack setting (not available on the current tier).
- Changing the documented log filter: `| host_provider="homelab"` stays the canonical pipeline filter.
- Provider-scoped alerts (follow-up feature `otel-env-provider-scoped-alerts` from 332).
- Go, Node and UI runtimes (already conform; `xstockstrat-ui` was re-checked for this spec).
- Changing the logic of `scripts/check-otel-produced-signals.py`: it keys on `host_provider`, not on the instance prefix (`:50-53`, `:505`). Its doc-string assertions must still pass after the FR-4 edits (a recon obligation).
- A Python service whose entrypoint runs more than one exporting process would keep the SDK id until a per-process discriminator is designed. This spec found none of the four does (see Recon Obligations), so the exclusion is currently empty.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — Python telemetry resource builder (`app/telemetry.py`, `_build_resource` at lines 31-43)
- `xstockstrat-ingest` — Python telemetry resource builder
- `xstockstrat-indicators` — Python telemetry resource builder
- `xstockstrat-agent` — Python telemetry resource builder

## Consumer Surface(s)

_Constitution **C-14**._

**None** — internal/platform-only. No UI segment and no agent MCP tool change. The id is a telemetry resource attribute consumed by operators through Grafana (Loki, Mimir, Tempo) and by `scripts/check-otel-produced-signals.py`.

## Proto Contract Changes

None.

## Config Key Changes

None. `HOST_PROVIDER` and `SERVICE_NAME` are existing startup env vars (feature 332), not config-service keys.

## Database Changes

None.

## Feature Workflow Notes

Branch to create: `feature/python-otel-instance-id` (branch from `main-dev`)
Approval gate required (per docs/runbooks/feature-workflow.md): 1 service owner approval (non-breaking, no proto or config change). No breaking-proto or schema-migration gate applies.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there. `@AC-7`, `@AC-8` and `@AC-18` are
tagged `@manual`: they need a live homelab stack and follow the 332 post-deploy-check precedent, so
`/sdd-spec` must not automate them.

## Constraints

- Ground FR-1 on a wire-level test of the exported resource for each of the four services. Feature 332 shipped with the Python instance-id source unverified (Ledger `fails.md`, feature 274 rule: read the pinned library's actual resolution path before claiming behavior).
- A fixed id keeps the replica assumption of 332 D-7 (one replica per service per stack) that Go, Node and UI already carry; `observability.md:111` documents the DO rolling-deploy overlap.

## Recon Obligations (design phase)

Not open product questions; each is evidence `/sdd-design` must gather and record in `recon.md`.

- **Resolved at spec time — single process per service:** analysis, ingest and indicators run `python -m app.main` ending in `asyncio.run(serve())`; agent runs `supervisord` with one program, `python -m app.main` (`services/xstockstrat-agent/supervisord.conf`). No workers, gunicorn or forks found, so FR-1 does not collide on any of the four. Recon re-confirms against the DO app specs.
- **Source of Python's current `service.instance.id`:** `_build_resource` sets none (`services/xstockstrat-analysis/app/telemetry.py:36-43`), yet live Grafana shows UUID instances. The pinned `opentelemetry-sdk` is not installed in this sandbox, so recon must read its `Resource.create` and detector path (and `OTEL_RESOURCE_ATTRIBUTES` interaction) and confirm that setting the attribute in `Resource.create` wins.
- **Series consumers on cutover:** the first deploy relabels the Python series once on DO dev and homelab (old UUID-instance series go stale). Recon confirms no dashboard, alert or recording rule keys on a Python `instance` value (current evidence: `packages/otel/` keys on `service_name`, never `job` or `instance`).
- **Guard tests:** covered by `@AC-12`. Recon also notes that `docs/patterns/observability.md` lines 60, 102 and 114-117 are the edit sites at spec time.
- **Indicators sandbox children:** `services/xstockstrat-indicators/app/services/sandbox.py` forks sandbox children (`:28`, `:659`). Recon confirms they never initialise OTel, so the single-exporting-process claim holds; also re-check the DO app specs.
- **Merge-order notes (non-blocking file overlaps from `/sdd-review`):** `app/telemetry.py` in analysis and indicators vs feature 329; `ingest/app/telemetry.py` vs feature 334 (code-completed); `docs/patterns/observability.md` vs feature 333. Re-anchor line references after 329 and 334 land and rebase the doc edit against 333.
