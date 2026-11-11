# Product Spec: homelab-otel-host-provider

**Created**: 2026-11-11

---

## Problem Statement

The homelab Compose stack hardcodes `OTEL_ENABLED: "false"` (`deploy/homelab/compose.yml:7`), so it exports nothing to Grafana Cloud, and nothing in the exported resource identifies the hosting platform. Today Grafana holds only DO dev data (`deployment_environment="staging"`, k8s-style `host_name`). Homelab staging currently renders `APPLICATION_ENV=development` (`scripts/homelab-release-env.sh:18`). This feature makes it `staging` (operator steer, 2026-11-11), so once homelab exports, homelab staging and DO dev both report `deployment_environment="staging"`. They would be indistinguishable except by the accidental shape of `host_name`, and the Go, Node and UI metric series, which carry no `instance` label, would be identical label sets from two senders. Homelab production would collide with DO production the same way once DO production exports.

## User Story

As an operator running the homelab Compose stack alongside the DO App Platform deployment, I want homelab services to export traces, metrics and logs to the same Grafana Cloud stack as DO, with every signal carrying a `host.provider` resource attribute (`digitalocean` | `homelab`), so that I can separate homelab from DO data in any query even when `deployment.environment` collides.

## Functional Requirements

FR-1. Every one of the 12 runtimes (Go: trading, portfolio, marketdata; Python: indicators, ingest, analysis, agent; Node: config, identity, ledger, notify; Next.js: ui) attaches a `host.provider` resource attribute to its trace, metric and log resource. Each resource builder reads `HOST_PROVIDER` itself and normalises it (FR-2); `OTEL_RESOURCE_ATTRIBUTES` is not used, and the deploy-spec guard rejects it (AC-22). Go, Node and UI also set `service.instance.id` to `<host.provider>-<service.name>` (for example `homelab-trading`) so their series carry an `instance` label; Python keeps its SDK-generated id.

FR-2. The `host.provider` value set is `digitalocean` | `homelab` | `unknown`. An unset or unrecognised `HOST_PROVIDER` (exact lowercase match required) resolves to `unknown`, is never fatal, and never prevents service startup (OTel init errors must never prevent startup).

FR-3. The homelab stack enables telemetry for both targets (staging and production). In `deploy/homelab/compose.yml` `x-common-env`, `OTEL_ENABLED: "true"` and `HOST_PROVIDER: homelab` are fixed literals, so no `.env` or `APP_ENV` value can change them. `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are required `${VAR:?}` variables that come from the pipeline-built release `.env`. `scripts/homelab-release-env.sh` renders homelab staging with `APPLICATION_ENV=staging` (TRADING_MODE stays `paper`). The deploy-spec guard also scans `deploy/homelab/compose.yml` for the sampler and gRPC-exclusion variables (AC-23).

FR-4. Homelab uses the same Grafana Cloud OTLP gateway endpoint and the same `Authorization=Basic …` header format as DO. Both SOPS files already hold `common.OTEL_EXPORTER_OTLP_ENDPOINT` and `common.OTEL_EXPORTER_OTLP_HEADERS`, but `scripts/sops_secrets.py:32-33` scopes them to DO only (`runbooks/sops-secrets.md:9`: "OTEL: DO only"), so `resolve --target homelab` does not emit them today. This feature adds the homelab target to those two `KEYS` rows so they reach the release `.env` through `APP_ENV`, and a missing endpoint or header fails the compose render naming the variable (`${VAR:?}` idiom), because the keys stay optional (`required=False`) for DO. The `Authorization=` prefix is added by one idempotent helper in `scripts/sops_secrets.py`, used both by `scripts/do-render-app-spec.py` and by `sops_secrets.py resolve --target homelab`, which masks the prefixed value. No credential is committed in plaintext and the header value is not printed in pipeline logs. Wiring that follows from the `KEYS` change: `.github/workflows/deploy-homelab.yml` gains `LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT` and `LEGACY_OTEL_EXPORTER_OTLP_HEADERS` env lines (the `secrets[format('{0}_…', env.P)]` form), because `scripts/sops-secrets.test.sh:1067` (`check_legacy … homelab`) derives the required `LEGACY_*` lines from `keys_for(HOMELAB)`. `COMMON_RE` (`scripts/sops-secrets.test.sh:747`) already lists both OTLP names and does not change.

FR-5. After a homelab deploy, an operator can restrict a PromQL query and a LogQL query to homelab (or to DO) by `host.provider`, and to both signals consistently. The OTel attribute `host.provider` is exported to Prometheus and Loki with dots mapped to underscores, so queries use the label name `host_provider`. The mechanism is a `target_info` join for metrics, `* on (job, instance, deployment_environment) group_left (host_provider) group by (job, instance, deployment_environment, host_provider) (target_info{…})`, and a structured-metadata filter for logs, `| host_provider="…"`. Both are documented with a copy-paste example, and `scripts/check-otel-produced-signals.sh` checks the documented blocks. Live verification against Grafana Cloud needs both stacks deployed, so it is a documented manual post-deploy operator check (FR-7), not an acceptance gate of this feature's PR.

FR-6. The homelab render check asserts, for each of the 12 runtime services (every service except `db-migrator`), that `OTEL_ENABLED` is `"true"`, `HOST_PROVIDER` is `homelab`, `OTEL_EXPORTER_OTLP_ENDPOINT` is non-empty and `OTEL_EXPORTER_OTLP_HEADERS` starts with `Authorization=`. The header check is a value-free boolean. It inverts `deploy/homelab/render-assert.jq:39`, adds `HOST_PROVIDER` and the OTLP boolean to the `env` projection (`:22`), and changes the staging `appenv` expectation (`:4`) to `staging`.

FR-7. `docs/patterns/observability.md` documents the `host.provider` attribute, its value set and the `unknown` default, the deterministic `service.instance.id` rule, the homelab export wiring, the query pattern from FR-5, the `OTEL_RESOURCE_ATTRIBUTES` constraint, the homelab egress precondition, and the manual post-deploy verification check; the deploy-time OTLP wiring is noted in the homelab runbook/pattern docs that currently say homelab has telemetry off.

FR-8. Every deployment target sets `HOST_PROVIDER` as in the table below; DO dev and DO prod set `digitalocean` explicitly in their app specs, and the local compose leaves it unset.

### Deployment target values (Constitution C-1)

| Target | File | `OTEL_ENABLED` | `HOST_PROVIDER` | Change in this feature |
|---|---|---|---|---|
| Local | `docker-compose.yml:18` | `${OTEL_ENABLED:-false}` (collector at `otel-collector:4318`) | unset → `unknown` | none (documented only) |
| DO dev | `.do/app.dev.yaml:32` | `"true"` | `digitalocean` | add `HOST_PROVIDER` |
| DO prod | `.do/app.yaml:32` | `"false"` (DO production does not export today) | `digitalocean` | add `HOST_PROVIDER`; enabling prod telemetry is out of scope |
| Homelab | `deploy/homelab/compose.yml:7` | `"true"` (compose literal) | `homelab` (compose literal) | replace the `"false"` literal; add the `HOST_PROVIDER` literal; require `OTEL_EXPORTER_OTLP_*` via `${VAR:?}` |

## Out of Scope

- Migrating off Grafana Cloud to self-hosted Grafana/Prometheus (explicit future work).
- A homelab-side OTel Collector (only if design proves direct export impossible).
- Changing the semantics of `deployment.environment`, `platform`, `service.name` or `host.name`. The only value changes are: homelab staging's `deployment.environment` goes `development` → `staging`; Go, Node and UI gain `service.instance.id = <host.provider>-<service.name>`.
- The DO → homelab cutover itself, and enabling telemetry on DO production (`.do/app.yaml` keeps `OTEL_ENABLED: "false"`).
- Dashboard or alert-rule changes. `packages/otel/dashboards/**` and `packages/otel/alerts/**` are not edited. Env/provider-scoped alerts and dashboard selectors are the named follow-up feature `otel-env-provider-scoped-alerts`.

## Affected Services

- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` — Go `internal/telemetry/otel.go` resource.
- `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent` — Python `app/telemetry.py` resource.
- `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify` — Node `src/telemetry.ts` `buildResource()`.
- `xstockstrat-ui` — `src/telemetry.ts` resource.
- Deploy surface (not a service): `deploy/homelab/compose.yml`, `scripts/homelab-release-env.sh` (staging `appenv` only), `.github/workflows/deploy-homelab.yml`, `scripts/sops_secrets.py` (`KEYS` rows and the prefix helper), `scripts/do-render-app-spec.py` (calls the helper), `deploy/homelab/render-assert.jq`, `.do/app.yaml` and `.do/app.dev.yaml` (add `HOST_PROVIDER=digitalocean`, FR-8), `scripts/sops-secrets.test.sh` (DO-side pins `:155-159, :522, :579, :669-678` and `COMMON_RE :747` are unchanged; `check_legacy … homelab` `:1067` moves; case 8 `:243-265` gains OTLP fixture lines), `scripts/homelab-render.test.sh`, `scripts/check-otel-produced-signals.sh` (+ its test and `packages/otel/produced-signals.tsv`), `docs/runbooks/sops-secrets.md`, `docs/patterns/observability.md`, `docs/patterns/ci-overview.md`, `docs/setup/grafana-cloud.md`, `services/xstockstrat-ui/CLAUDE.md`, and `packages/proto/docs/context-constitution-findings.md` (a findings entry only, no proto edit).

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — operator-facing observability only. The capability is consumed in Grafana Cloud queries, dashboards and alerts by the operator; no `xstockstrat-ui` segment or MCP tool changes. Env/provider-scoped alerts and dashboard selectors are the named follow-up feature `otel-env-provider-scoped-alerts` (C-14: no end-user surface exists here).

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

Overlap sequencing (from the `/sdd-review` overlap scan, advisory; recorded in `docs/roadmap/features/merge-order.md`): `deploy-homelab.yml` is also edited by 307 (`ui-env-themed-bundles`, code-completed; its `sops-secrets.test.sh` pins constrain step order around `resolve`; FR-4 edits the same test file's OTLP pins), the telemetry resource builders by 329 (`fix-telemetry-startup-log`), and `.do/app*.yaml` by 331 (`fix-agent-mcp-transport-fallthrough`). Rebase after 307; coordinate with 329 and 331.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

All resolved or decided in `/sdd-design` (see `design.md` and `debate.md`).

- [x] **Injection mechanism** — RESOLVED (D-1): `HOST_PROVIDER` is hand-read with an inline normaliser in each of the 12 resource builders; `OTEL_RESOURCE_ATTRIBUTES` is not used (R-5).
- [x] **Default when unset** — RESOLVED by operator: `unknown`; DO dev and DO prod set `digitalocean` explicitly (FR-2, FR-8).
- [x] **Queryability** — RESOLVED (D-3, D-9, D-14, D-20). Grafana Cloud promotes `deployment.environment` to a series label (`deployment_environment`) and `service.instance.id` to `instance`, but `host.provider` stays on `target_info` only; this corrects the earlier draft, which said all resource attributes were `target_info`-only. Provider filtering therefore uses the `target_info` join of FR-5 and a structured-metadata filter for logs; no Grafana-side promotion setting is relied on (R-1).
- [x] **Credential delivery** — RESOLVED by recon: the OTLP keys are already in both SOPS files; FR-4 extends the `KEYS` target and adds the prefix helper.
- [x] **Per-environment endpoints** — RESOLVED by operator: staging and production share one Grafana Cloud instance, so `deployment.environment` and `host.provider` are independent axes on one stack and every documented query filters both.
- [x] **Free-tier ceiling** — RESOLVED: operator waived it. Three exporting stacks (DO dev, homelab staging, homelab production) are about 3,600 active series plus Python restart churn; recorded in `design.md`.
- [x] **Known traps (ledger)** — ADDRESSED in design: pipeline-owned/asserted values per service (FR-6), Node `buildResource` verified against both test runners and the production `tsc` build, and recon re-read the specs instead of trusting prose.
