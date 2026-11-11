# Product Spec: homelab-otel-host-provider

**Created**: 2026-11-11

---

## Problem Statement

The homelab Compose stack hardcodes `OTEL_ENABLED: "false"` (`deploy/homelab/compose.yml:7`), so it exports nothing to Grafana Cloud, and nothing in the exported resource identifies the hosting platform. Grafana currently holds only DO data (`deployment_environment="staging"`, k8s-style `host_name`). Once homelab exports, a homelab staging stack and the DO dev app would both report `deployment_environment="staging"` and be indistinguishable except by the accidental shape of `host_name`.

## User Story

As an operator running the homelab Compose stack alongside the DO App Platform deployment, I want homelab services to export traces, metrics and logs to the same Grafana Cloud stack as DO, with every signal carrying a `host.provider` resource attribute (`digitalocean` | `homelab`), so that I can separate homelab from DO data in any query even when `deployment.environment` collides.

## Functional Requirements

FR-1. Every one of the 12 runtimes (Go: trading, portfolio, marketdata; Python: indicators, ingest, analysis, agent; Node: config, identity, ledger, notify; Next.js: ui) attaches a `host.provider` resource attribute to its trace, metric and log resource. The `HOST_PROVIDER` environment variable is the deploy-time interface that sets it; how each runtime reads it (hand-read at init vs the SDK's `OTEL_RESOURCE_ATTRIBUTES` merge) is a design decision.

FR-2. The `host.provider` value set is `digitalocean` | `homelab` | `unknown`. An unset or unrecognised `HOST_PROVIDER` (exact lowercase match required) resolves to `unknown`, is never fatal, and never prevents service startup (OTel init errors must never prevent startup).

FR-3. The homelab stack enables telemetry: `OTEL_ENABLED` is no longer a hardcoded `"false"` literal, and each homelab service receives `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_ENABLED=true` and `HOST_PROVIDER=homelab` from the pipeline-owned release `.env`. `scripts/homelab-release-env.sh` owns `OTEL_ENABLED` and `HOST_PROVIDER` (added to its `owned` filter and written explicitly), so an `APP_ENV` copy cannot override them.

FR-4. Homelab uses the same Grafana Cloud OTLP gateway endpoint and the same `Authorization=Basic …` header format as DO. Both SOPS files already hold `common.OTEL_EXPORTER_OTLP_ENDPOINT` and `common.OTEL_EXPORTER_OTLP_HEADERS`, but `scripts/sops_secrets.py:32-33` scopes them to DO only (`runbooks/sops-secrets.md:9`: "OTEL: DO only"), so `resolve --target homelab` does not emit them today. This feature adds the homelab target to those two `KEYS` rows so they reach the release `.env` through `APP_ENV`; the homelab pipeline adds the `Authorization=` prefix exactly once, as DO does (`scripts/do-render-app-spec.py:104-107`); and a missing endpoint or header fails the compose render naming the variable (`${VAR:?}` idiom), because the keys stay optional (`required=False`) for DO. No credential is committed in plaintext and the header value is not printed in pipeline logs (SOPS-decrypted values are already masked). Wiring that follows from the `KEYS` change: `.github/workflows/deploy-homelab.yml` gains `LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT` and `LEGACY_OTEL_EXPORTER_OTLP_HEADERS` env lines (the `secrets[format('{0}_…', env.P)]` form), because `scripts/sops-secrets.test.sh:1067` (`check_legacy … homelab`) derives the required `LEGACY_*` lines from `keys_for(HOMELAB)`; and `scripts/homelab-release-env.sh` rewrites the quoted header line in `APP_ENV` to add the prefix.

FR-5. After a homelab deploy, an operator can restrict a PromQL query and a LogQL query to homelab (or to DO) by `host.provider`, and to both signals consistently. The OTel attribute `host.provider` is exported to Prometheus and Loki with dots mapped to underscores, so queries use the label name `host_provider`. The mechanism (series label, `target_info` join, or promoted Loki label) is decided in design and documented with a copy-paste example. Acceptance is deterministic: a repo test parses the documented queries. Live verification against Grafana Cloud needs both stacks deployed, so it is a documented manual post-deploy operator check (FR-7), not an acceptance gate of this feature's PR.

FR-6. The homelab render test asserts, for each of the 12 runtime services in the rendered compose (every service except `db-migrator`, which has no telemetry module), that `HOST_PROVIDER=homelab` and `OTEL_ENABLED=true`. This inverts the existing assertion in `deploy/homelab/render-assert.jq` (line 39 currently fails on `OTEL_ENABLED != "false"`) and adds `HOST_PROVIDER` to its `env` projection (line 22), so a missing or defaulted value cannot ship silently.

FR-7. `docs/patterns/observability.md` documents the `host.provider` attribute, its value set and the `unknown` default, the homelab export wiring, the query pattern from FR-5, and the manual post-deploy verification check; the deploy-time OTLP wiring is noted in the homelab runbook/pattern docs that currently say homelab has telemetry off.

FR-8. Every deployment target sets `HOST_PROVIDER` as in the table below; DO dev and DO prod set `digitalocean` explicitly in their app specs, and the local compose leaves it unset.

### Deployment target values (Constitution C-1)

| Target | File | `OTEL_ENABLED` | `HOST_PROVIDER` | Change in this feature |
|---|---|---|---|---|
| Local | `docker-compose.yml:18` | `${OTEL_ENABLED:-false}` (collector at `otel-collector:4318`) | unset → `unknown` | none (documented only) |
| DO dev | `.do/app.dev.yaml:32` | `"true"` | `digitalocean` | add `HOST_PROVIDER` |
| DO prod | `.do/app.yaml:32` | `"false"` (DO production does not export today) | `digitalocean` | add `HOST_PROVIDER`; enabling prod telemetry is out of scope |
| Homelab | `deploy/homelab/compose.yml:7` | `"true"` (pipeline-owned) | `homelab` (pipeline-owned) | un-hardcode `OTEL_ENABLED`; wire `HOST_PROVIDER` and `OTEL_EXPORTER_OTLP_*` |

## Out of Scope

- Migrating off Grafana Cloud to self-hosted Grafana/Prometheus (explicit future work).
- A homelab-side OTel Collector (only if design proves direct export impossible).
- Changing the semantics of `deployment.environment`, `platform`, `service.name` or `host.name`.
- The DO → homelab cutover itself, and enabling telemetry on DO production (`.do/app.yaml` keeps `OTEL_ENABLED: "false"`).
- Dashboard or alert-rule redesign beyond what FR-5/FR-7 require (design decides whether `packages/otel/dashboards/service-detail.json` and `packages/otel/alerts/alert-rules.yaml` gain a `host.provider` selector; any such change is a named step, not implied).

## Affected Services

- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` — Go `internal/telemetry/otel.go` resource.
- `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent` — Python `app/telemetry.py` resource.
- `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify` — Node `src/telemetry.ts` `buildResource()`.
- `xstockstrat-ui` — `src/telemetry.ts` resource.
- Deploy surface (not a service): `deploy/homelab/compose.yml`, `scripts/homelab-release-env.sh`, `.github/workflows/deploy-homelab.yml`, `scripts/sops_secrets.py`, `deploy/homelab/render-assert.jq`, `.do/app.yaml`, `.do/app.dev.yaml` (add `HOST_PROVIDER=digitalocean`, FR-8), `scripts/sops_secrets.py` (`KEYS` rows for the two OTLP keys), `scripts/sops-secrets.test.sh` (the DO-side OTLP pins at lines 155-159, 522 and 579 are unaffected; the homelab pins that move are `COMMON_RE` at line 747 and `check_legacy … homelab` at line 1067), `docs/runbooks/sops-secrets.md` (line 9 "OTEL: DO only"), and `scripts/do-render-app-spec.py` only if design extracts the `Authorization=` prefix into a shared helper.

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

Overlap sequencing (from the `/sdd-review` overlap scan, advisory): `deploy-homelab.yml` is also edited by 307 (`ui-env-themed-bundles`, code-completed; its `sops-secrets.test.sh` pins constrain step order around `resolve`; FR-4 edits the same test file's OTLP pins), the telemetry resource builders by 329 (`fix-telemetry-startup-log`), and `.do/app*.yaml` by 331 (`fix-agent-mcp-transport-fallthrough`). Rebase after 307; coordinate with 329 and 331.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Injection mechanism** — DEFERRED to `/sdd-design` (owner: Platform Lead, via design debate round 1). A `HOST_PROVIDER` env var hand-read in all 12 resource builders vs the SDKs' `OTEL_RESOURCE_ATTRIBUTES` merge; needs per-language verification that the env resource merges with the code-defined one and which wins on conflict. FR-1 binds only the deploy interface.
- [x] **Default when unset** — RESOLVED by operator: `unknown`; DO dev and DO prod set `digitalocean` explicitly (FR-2, FR-8).
- [x] **Queryability** (FR-5, load-bearing) — DEFERRED to `/sdd-design` (owner: Platform Lead, via the design debate; the Grafana-side promotion setting is an operator action outside the repo). In Grafana Cloud, resource attributes land on `target_info`, not on the metric series (verified live: `deployment_environment`, `host_name` appear on `target_info`), so filtering `rpc_server_duration_milliseconds_*` by `host_provider` needs a `group_left` join on `(job, instance)` unless the attribute is promoted. For logs, `docs/patterns/observability.md` line 22 makes only `service_name` a stream label and `platform` structured metadata, so `host_provider` defaults to structured metadata. Design decides: promote vs document the join/metadata query, and which PromQL/LogQL parser the AC-10/AC-11 tests use.
- [x] **Credential delivery** (FR-4) — RESOLVED by recon on 2026-11-11. `secrets/staging.enc.yaml:9-10` and `secrets/production.enc.yaml:9-10` both hold `common.OTEL_EXPORTER_OTLP_ENDPOINT` and `_HEADERS`; DO substitutes them into the `YOUR_DEV_*`/`YOUR_PROD_*` placeholders in `scripts/do-render-app-spec.py` (not in `deploy-dev.yml`). `KEYS` scopes them to DO only, so FR-4 extends the target to homelab. Remaining design choice (owner: Platform Lead, design): where the `Authorization=` prefix lives for homelab — `homelab-release-env.sh` or a helper shared with `do-render-app-spec.py` (DRY guard rail).
- [x] **Per-environment endpoints** — RESOLVED by operator (2026-11-11): staging and production share one Grafana Cloud instance, so homelab staging and homelab production write to the same stack as DO (`docs/setup/grafana-cloud.md:151-152`: same URL/token when sharing one stack). Consequence for queries: `deployment.environment` (`staging` | `production`) and `host.provider` are independent axes on one stack, so a query that filters only one of them mixes the other (the staging collision in the Problem Statement). Design's query examples (FR-5, FR-7) must show both filters.
- [x] **Free-tier ceiling** — RESOLVED: operator waived it while DO and homelab coexist. The dev baseline is ~1,200 active series (`observability.md` § Cost); design records the expected total so a cap breach is not discovered by dropped data.
- [x] **Known traps (ledger)** — CARRIED to design recon. (1) `fails.md` homelab-compose-deploy (config): a new deploy target's env must be derived from what each service READS, and the pipeline must own and assert mode/environment values for every service in the render test — drives FR-3/FR-6. (2) `fails.md` 171-fix-agent-trading-mode-otel-attr (assumption): Node `buildResource` changes must be verified against both Node test runners and the production `tsc` build in each of the four leaf services. (3) `fails.md` phase7-observability (assumption): the earlier spec asserted false premises about existing OTEL env wiring; recon re-reads `.do/app*.yaml` rather than trusting this spec's summary (the per-target table above was read from the tree on 2026-11-11).
