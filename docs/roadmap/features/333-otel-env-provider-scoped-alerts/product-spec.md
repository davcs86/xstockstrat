# Product Spec: otel-env-provider-scoped-alerts

**Created**: 2026-11-11

---

## Problem Statement

Feature 332 makes three stacks export to one shared Grafana Cloud instance: DO dev (`deployment_environment="staging"`, `host_provider="digitalocean"`), homelab staging (`staging`/`homelab`) and homelab production (`production`/`homelab`). The three alert rules in `packages/otel/alerts/alert-rules.yaml` have no `deployment_environment` or `host_provider` matcher: the error-rate rule (`xstk-error-rate-high`, expr `:50`) and the P99 latency rule (`xstk-p99-latency-high`, `:96`) aggregate `by (service_name)`, so an error or a slow RPC in any stack fires the same alert with no stack label; and the analysis heartbeat (`xstk-analysis-no-scoring`, Loki expr `:146`, `noDataState: Alerting` at `:131`) counts `{service_name="analysis"} |= "live_loop: cycle complete"` across every stack, so a live homelab loop masks a dead DO dev loop. The service-detail dashboard filters only by `environment` (`packages/otel/dashboards/service-detail.json:66-83`), so DO dev and homelab staging are merged under `staging`.

## User Story

As the operator of a shared Grafana Cloud stack that receives telemetry from DO dev, homelab staging and homelab production, I want the Grafana alert rules and the service-detail dashboard to be scoped by `deployment_environment` and `host_provider`, so that an error in one stack pages with a label naming that stack, and a live loop in one stack cannot hide a dead loop in another.

## Functional Requirements

FR-1. The error-rate rule evaluates the ratio per `service_name` × `deployment_environment` × `host_provider`, and a firing alert carries those three labels. A >1% error rate in one stack fires only for that stack.

FR-2. The P99 latency rule evaluates per `service_name` × `deployment_environment` × `host_provider`, and a firing alert carries those three labels.

FR-3. The analysis heartbeat alerts per exporting stack: if any expected stack has logged no `live_loop: cycle complete` in 30 minutes, an alert fires naming that stack (`deployment_environment`, `host_provider`), even while another stack's loop is live. The set of expected stacks is explicit and documented.

FR-4. `packages/otel/dashboards/service-detail.json` gains a `host_provider` variable beside the existing `environment` variable, and every metric and log panel filters by both.

FR-5. `scripts/check-otel-produced-signals.sh` (CI job `otel-signals`) passes: every series, label and log literal the new expressions use is registered or produced, and the existing server-streaming `rpc_method!~` exclusion is kept byte-identical on every `rpc_server_duration_*` selector.

FR-6. `docs/patterns/observability.md` and `packages/otel/alerts/README.md` / `packages/otel/dashboards/README.md` document the scoping, the expected-stack list and how to change it, and the manual re-import of the alert rules.

## Out of Scope

- Grafana-side resource-attribute promotion of `host.provider` (feature 332, R-1).
- Enabling DO production telemetry (`.do/app.yaml` keeps `OTEL_ENABLED: "false"`).
- New instruments, metrics or log lines; changes to any service's code.
- Automating alert-rule deployment: alerts stay a manual import (feature 297, G11).
- Other dashboards than `service-detail.json`.

## Affected Services

None of the runtime services change. The change set is `packages/otel/alerts/alert-rules.yaml`, `packages/otel/dashboards/service-detail.json`, `packages/otel/produced-signals.tsv` (if a new literal needs registering), `scripts/check-otel-produced-signals.sh` and its test (only if the guard needs a new rule), and docs. `xstockstrat-analysis` is named only because its `live_loop: cycle complete` log line is the heartbeat's producer contract (unchanged).

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — the consumer is the operator in Grafana (alert notifications and the service-detail dashboard); no `xstockstrat-ui` segment or MCP tool changes. This feature is itself the named C-14 follow-up of feature 332.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/otel-env-provider-scoped-alerts` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — Platform Lead (observability contract)
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

Sequencing: depends on feature 332 (`homelab-otel-host-provider`) being merged (`host.provider` in code, the `target_info` registry row, the documented join). Sequence after 297 (`grafana-dashboards-ci-deploy`), which owns the CI deploy of `packages/otel/dashboards/**` and appends to `produced-signals.tsv`.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Per-stack absence (FR-3, load-bearing):** Grafana evaluates per series, and a stack that stops logging produces no series, so `sum by (deployment_environment, host_provider)` alone cannot detect a dead stack while another stack is live. Options for design: one rule per expected stack, an explicit expected-stack list joined against the observed series, or `absent_over_time` per stack. Which stacks are expected also changes over time (DO dev goes away at the cutover).
- [ ] **LogQL grouping by structured metadata:** `host_provider` is Loki structured metadata, not a stream label (feature 332 recon); confirm `sum by (host_provider)` on a metric query works on the shared stack, against live data.
- [ ] **Join in alert expressions:** FR-1/FR-2 need the feature-332 `target_info` join (`on (job, instance, deployment_environment) group_left (host_provider)` over `group by (job, instance, deployment_environment, host_provider) (target_info{…})`) inside Grafana-managed rules; confirm evaluation works and the `host_provider` label survives into the alert labels.
- [ ] **Acceptance without live Grafana:** the operator ruled out live smoke gates for 332; decide which deterministic repo checks (guard extensions, rule-file structure checks) prove FR-1..FR-4, and which checks are a documented manual post-import step.
- [ ] **Known traps (ledger):** `fails.md` 2026-11-04 fix-screener-symbol-isolation (read the rule and verify the series it keys on exists today) and 2026-11-04 fix-otel-metrics-logs-gap (sweep every alert, dashboard and setup doc together); `insights.md` 2026-11-11 homelab-otel-host-provider (verify label promotion and join cardinality against the live datasource, including across a restart).
