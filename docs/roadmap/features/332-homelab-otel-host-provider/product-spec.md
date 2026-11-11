# Product Spec: homelab-otel-host-provider

**Created**: 2026-11-11

---

## Problem Statement

The homelab Compose stack hardcodes `OTEL_ENABLED: "false"` (`deploy/homelab/compose.yml:7`), so it exports nothing to Grafana Cloud, and nothing in the exported resource identifies the hosting platform. Grafana currently holds only DO data (`deployment_environment="staging"`, k8s-style `host_name`). Once homelab exports, a homelab staging stack and the DO dev app would both report `deployment_environment="staging"` and be indistinguishable except by the accidental shape of `host_name`.

## User Story

As an operator running the homelab Compose stack alongside the DO App Platform deployment, I want homelab services to export traces, metrics and logs to the same Grafana Cloud stack as DO, with every signal carrying a `host_provider` resource attribute (`digitalocean` | `homelab`), so that I can separate homelab from DO data in any query even when `deployment.environment` collides.

## Functional Requirements

FR-1. Every one of the 12 runtimes (Go: trading, portfolio, marketdata; Python: indicators, ingest, analysis, agent; Node: config, identity, ledger, notify; Next.js: ui) attaches a `host_provider` resource attribute to its trace, metric and log resource, read from the `HOST_PROVIDER` environment variable at init.

FR-2. The `host_provider` value set is closed: `digitalocean` | `homelab`. An unset or unrecognised `HOST_PROVIDER` resolves to a single documented default (value chosen in design), is never fatal, and never prevents service startup (OTel init errors must never prevent startup).

FR-3. The homelab stack enables telemetry: `OTEL_ENABLED` is no longer a hardcoded `"false"` literal, and each homelab service receives `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` and `HOST_PROVIDER=homelab` from the pipeline-owned release `.env`.

FR-4. Homelab uses the same Grafana Cloud OTLP gateway endpoint and the same `Authorization=Basic …` header format as DO, delivered through the existing SOPS `resolve --target homelab` path. No credential is committed in plaintext and the header value is not printed in pipeline logs.

FR-5. After a homelab deploy, an operator can restrict a PromQL query and a LogQL query to homelab (or to DO) by `host_provider`, and to both signals consistently. The mechanism (series label, `target_info` join, or promoted Loki label) is decided in design and documented with a copy-paste example.

FR-6. The homelab render test asserts, for every service in the rendered compose, that `HOST_PROVIDER=homelab` and `OTEL_ENABLED=true` (a pipeline-owned value asserted per service, so a missing or defaulted value cannot ship silently).

FR-7. `docs/patterns/observability.md` documents the `host_provider` attribute, its value set and default, the homelab export wiring, and the query pattern from FR-5; the deploy-time OTLP wiring is noted in the homelab runbook/pattern docs that currently say homelab has telemetry off.

## Out of Scope

- Migrating off Grafana Cloud to self-hosted Grafana/Prometheus (explicit future work).
- A homelab-side OTel Collector (only if design proves direct export impossible).
- Changing the semantics of `deployment.environment`, `platform`, `service.name` or `host.name`.
- The DO → homelab cutover itself.
- Dashboard or alert-rule redesign beyond what FR-5/FR-7 require (design decides whether `packages/otel/dashboards/service-detail.json` and `packages/otel/alerts/alert-rules.yaml` gain a `host_provider` selector; any such change is a named step, not implied).

## Affected Services

- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` — Go `internal/telemetry/otel.go` resource.
- `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent` — Python `app/telemetry.py` resource.
- `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify` — Node `src/telemetry.ts` `buildResource()`.
- `xstockstrat-ui` — `src/telemetry.ts` resource.
- Deploy surface (not a service): `deploy/homelab/compose.yml`, `scripts/homelab-release-env.sh`, `.github/workflows/deploy-homelab.yml`, `scripts/sops_secrets.py`, `deploy/homelab/render-assert.jq`, `.do/app*.yaml` (sets `HOST_PROVIDER=digitalocean` explicitly if design rejects an implicit default).

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — operator-facing observability only. The capability is consumed in Grafana Cloud queries, dashboards and alerts by the operator; no `xstockstrat-ui` segment or MCP tool changes. Dashboard/alert selectors, if any, are decided in design and recorded as steps (C-14: no deferred end-user surface exists here).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. `HOST_PROVIDER` and the `OTEL_*` variables are deploy-time env vars read once at init (same class as `OTEL_ENABLED`, which is not a config key per `docs/patterns/observability.md`), not `WatchConfig` keys.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/homelab-otel-host-provider` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — applies per touched service plus Platform Lead and Security (credential wiring)
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Injection mechanism** (design fork): a `HOST_PROVIDER` env var read by hand in all 12 resource builders, vs. relying on the SDKs' own `OTEL_RESOURCE_ATTRIBUTES` merge (needs verification per language that the env resource merges with the code-defined one and which wins on conflict). Operator chose the attribute name `host_provider`, not the mechanism.
- [ ] **Default when unset** (FR-2): `digitalocean` (zero DO deploy changes, but a silent wrong value for any future third target) vs. an explicit `unknown` plus `HOST_PROVIDER=digitalocean` added to `.do/app*.yaml`. Operator said DO will be cut over, which argues for the explicit form.
- [ ] **Queryability** (FR-5, load-bearing): in Grafana Cloud, resource attributes land on `target_info`, not on the metric series (verified live: `deployment_environment`, `host_name` appear on `target_info`). Filtering `rpc_server_duration_milliseconds_*` by `host_provider` therefore needs a `group_left` join on `(job, instance)` unless the attribute is promoted. For logs, `docs/patterns/observability.md` line 22 says only `service_name` is a stream label and `platform` is structured metadata, so `host_provider` would default to structured metadata. Decide whether to promote it (Grafana Cloud OTLP resource-attribute promotion setting, an operator action outside the repo) or document the join/metadata query.
- [ ] **Credential delivery** (FR-4): confirm the DO OTLP endpoint/header source (`.do/app.dev.yaml` renders `OTEL_EXPORTER_OTLP_*` placeholders from the deploy workflow) maps to SOPS keys that `sops_secrets.py resolve --target homelab` can emit, or whether new SOPS keys are needed (`docs/runbooks/sops-secrets.md` § adding a key). Header-bearing env must stay out of workflow logs.
- [ ] **Per-environment endpoints**: does homelab staging write to the same Grafana Cloud stack/tenant as DO dev, and does homelab production get its own? (Same stack is assumed by the operator's "same as DO"; confirm the header/instance for production.)
- [ ] **Free-tier ceiling**: operator waived this (not a constraint) while DO and homelab coexist; the dev baseline is ~1,200 active series (`observability.md` § Cost), so a second full stack roughly doubles that against the free-tier series cap. Design should record the expected total so a cap breach is not discovered by dropped data.
- [ ] **Known traps (ledger)**: (1) `fails.md` homelab-compose-deploy (config): a new deploy target's env must be derived from what each service READS and the pipeline must own and assert mode/environment values for every service in the render test — drives FR-3/FR-6. (2) `fails.md` 171-fix-agent-trading-mode-otel-attr (assumption): Node `buildResource` changes must be verified against both Node test runners and the production `tsc` build in each of the four leaf services. (3) `fails.md` phase7-observability (assumption): the earlier spec asserted false premises about existing OTEL env wiring; recon for this feature must re-read `.do/app*.yaml` and `deploy-dev.yml` rather than trust this spec's summary (note `deploy-dev.yml` has no `OTEL_EXPORTER_OTLP*` match; the endpoint/headers appear in `.do/app.dev.yaml` as placeholders, so the substitution site must be located in design recon).
