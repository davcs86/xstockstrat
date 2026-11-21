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

FR-3. The analysis heartbeat alerts per exporting stack: if any expected stack has logged no `live_loop: cycle complete` in 30 minutes, an alert fires naming that stack (`deployment_environment`, `host_provider`), even while another stack's loop is live. The expected stacks are exactly the three that export today — `staging`/`digitalocean`, `staging`/`homelab`, `production`/`homelab` (DO production telemetry is off) — and the list is explicit in the rule file, so a stack that emits nothing still has a rule that can fire.

FR-4. `packages/otel/dashboards/service-detail.json` gains a `host_provider` variable beside the existing `environment` variable, with its options taken from `target_info`. Every metric panel restricts to the selected `host_provider` through the feature-332 `target_info` join (`host_provider` is not a label on the `rpc_server_duration_*` / `http_server_duration_*` series), and every log panel restricts to it with a pipeline filter (`| host_provider=~"$host_provider"`; on Loki it is structured metadata, not a stream label). Both keep the existing `deployment_environment` filter.

FR-5. `scripts/check-otel-produced-signals.py` (CI job `otel-signals`; tests in `scripts/tests/test_check_otel_produced_signals.py`) passes: every series, label and log literal the new expressions use is registered or produced, and the existing server-streaming `rpc_method!~` exclusion is kept byte-identical on every `rpc_server_duration_*` selector.

FR-6. `docs/patterns/observability.md` and `packages/otel/alerts/README.md` / `packages/otel/dashboards/README.md` document the scoping, the expected-stack list and how to change it, and the manual re-import of the alert rules.

## Out of Scope

- Grafana-side resource-attribute promotion of `host.provider` (feature 332, R-1).
- Enabling DO production telemetry (`.do/app.yaml` keeps `OTEL_ENABLED: "false"`).
- New instruments, metrics or log lines; changes to any service's code.
- Automating alert-rule deployment: alerts stay a manual import (feature 297, G11).
- Other dashboards than `service-detail.json`.

## Affected Services

None of the runtime services change. The change set is `packages/otel/alerts/alert-rules.yaml`, `packages/otel/dashboards/service-detail.json`, `packages/otel/produced-signals.tsv` (if a new literal needs registering), `scripts/check-otel-produced-signals.py` and `scripts/tests/test_check_otel_produced_signals.py` (only if the guard needs a new rule or a rule-structure check), and docs. `xstockstrat-analysis` is named only because its `live_loop: cycle complete` log line is the heartbeat's producer contract (unchanged).

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

Sequencing: depends on feature 332 (`homelab-otel-host-provider`), which is merged to `main-dev` (`f99f667`, PR #1518): `host.provider` is in code, `target_info` is registered (`produced-signals.tsv`), and the join is documented (`docs/patterns/observability.md` § Separating DO and homelab). No hard dependency on 297 (`grafana-dashboards-ci-deploy`, `spec-ready`): if 297 has not shipped, the dashboard is re-imported manually like the alerts (FR-6). Both features edit `packages/otel/produced-signals.tsv` and `packages/otel/dashboards/README.md`, so whichever merges second rebases and re-anchors (file-level overlap, non-blocking).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Per-stack absence (FR-3, load-bearing):** answered at product level — the expected-stack list is the explicit, fixed set of three exporting pairs named in FR-3, kept in the rule file, so each expected stack has a rule that fires on silence (`noDataState: Alerting`) even while another stack is live; a pair is added or removed by editing that list (e.g. `staging`/`digitalocean` at the DO cutover), documented per FR-6. The mechanism (one rule per pair vs `absent_over_time` per pair) is deferred to `/sdd-design` and settles there as a `D-n`.
- [x] **LogQL grouping by structured metadata:** deferred to `/sdd-design` recon — confirm against the live Loki datasource that a metric query can `sum by (deployment_environment, host_provider)` over structured metadata; if it cannot, the per-pair rules of FR-3 filter each pair with a pipeline filter instead, which needs no grouping.
- [x] **Join in alert expressions:** deferred to `/sdd-design` recon — confirm against the live datasource that a Grafana-managed rule evaluates the feature-332 `target_info` join and that `host_provider` survives into the alert labels. FR-1/FR-2 state the required outcome; the expression is a design output.
- [x] **Acceptance without live Grafana:** answered — no live smoke gate (operator decision on 332), and every scenario is covered by a CI test step (C-15). Structure checks prove AC-1, AC-3, AC-5, AC-6 and AC-9; the produced-signal guard proves AC-7; a doc check proves AC-8. The firing outcomes AC-2 and AC-4 are proved by evaluating the rule expressions offline against synthetic input, never against the live stack. The evaluator is deferred to `/sdd-design`, under these bounds: the PromQL rules (AC-2) use an offline rule evaluator such as `promtool test rules`, with the `target_info` join fed as synthetic input; the LogQL heartbeat (AC-4) uses an offline LogQL evaluation if one fits, and otherwise a named CI test that (1) asserts AC-9's structure for each pair and (2) applies each pair's check filter to AC-4's synthetic lines and asserts the `staging`/`digitalocean` check counts 0 lines in its `[30m]` window (so it alerts) while the `staging`/`homelab` check counts more than 0 (so it does not). If that fallback is chosen, AC-4's `When` is reworded to name that test, keeping the ID (C-15). Design records the choice as a `D-n`. The operator's post-import check in Grafana (AC-8) is documentation, not a gate.

## Design Notes

- Known traps (ledger), for `/sdd-design`: `fails.md` 2026-11-04 fix-screener-symbol-isolation (read the rule and verify the series it keys on exists today) and 2026-11-04 fix-otel-metrics-logs-gap (sweep every alert, dashboard and setup doc together); `insights.md` 2026-11-11 homelab-otel-host-provider (verify label promotion and join cardinality against the live datasource, including across a restart).
