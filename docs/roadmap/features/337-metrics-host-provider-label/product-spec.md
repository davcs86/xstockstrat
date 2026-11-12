# Product Spec: metrics-host-provider-label

**Created**: 2026-11-12

---

## Problem Statement

Feature 332 stamps `host.provider` on every resource, but Grafana Cloud Mimir keeps it only on `target_info`; metric series carry `job`, `instance`, `deployment_environment`, `service_name`, `service_instance_id` plus their own attributes. Provider-scoped metric queries need `* on (job, instance, deployment_environment) group_left (host_provider) group by (...) (target_info{...})` (`docs/patterns/observability.md` § "Separating DO and homelab"). DO dev and homelab staging both report `deployment_environment="staging"` on one stack, so the operator filters by provider constantly and the join is error-prone and costly to write.

## User Story

As an operator comparing homelab and DO on one Grafana Cloud stack, I want `host_provider` as a label on every metric series, so that I can write `rpc_server_duration_milliseconds_count{host_provider="homelab"}` without a `target_info` join.

## Functional Requirements

FR-1. After deploy, every metric series exported by the 12 runtimes (Go: trading, portfolio, marketdata; Node: ledger, identity, notify, config; Next.js: ui; Python: analysis, ingest, indicators, agent) carries a `host_provider` label in Grafana Cloud Mimir with a value in `homelab` | `digitalocean` | `unknown`, queryable with no `target_info` join. This includes `rpc_server_duration_milliseconds_*`, the UI's `http.server.duration`, the agent's `mcp.tool.duration`, and each service's own non-RPC instruments (for example config's `config.listener_up`), not only RPC histograms. `rpc.client.*` instruments are absent by contract (`@AC-56 @feature-294`).

FR-2. The label value is the one already resolved for the `host.provider` resource attribute (feature 332 normaliser: exact lowercase, unset/unrecognised → `unknown`). No second reader of `HOST_PROVIDER` and no second normaliser per runtime.

FR-3. Applying the mechanism never prevents startup and never loses a batch: any failure (at construction or on any export) resolves to the pre-feature behavior (the original, unlabelled batch is exported), is logged once per wrapper instance, and is not fatal (OTel init errors must never prevent startup).

FR-4. The mechanism is chosen by evidence in `/sdd-design` from options A (Grafana-side `MimirOTLPConfiguration` promotion), B (SDK-side datapoint attribute) and C (status quo). Chosen: B, a per-runtime metric-exporter wrapper (`design.md`). The spec fixes the outcome, not the mechanism. Any option that needs a paid tier, a Grafana Labs support ticket, or an operator-run CLI step is flagged to the operator as a fork before it is adopted.

FR-5. Series cost is bounded and recorded: the added label must not raise active series beyond the budget in `docs/patterns/observability.md` (§ cost), which is updated with the measured delta. A `host_provider` label on a single-sender series adds zero series; the design measures this rather than assuming it. Baseline T0 = 2671 active series (`max_over_time(grafanacloud_instance_active_series[1h])`, datasource `grafanacloud-usage`, 2026-11-12, DO dev only); `@AC-6` measures from it.

FR-6. Existing contracts are preserved: the `host.provider` resource attribute and `target_info` row from 332, the logs filter `| host_provider="homelab"`, `service.instance.id` rules, `serverMetricViews` (`@AC-56 @feature-294`), and the metric-label allowlist tests (e.g. UI `src/lib/__tests__/bffAllowlist.test.ts`, per-service telemetry tests) stay green with no edit, because the label is added after aggregation. Three `@feature-294` sentences (`@AC-41`, `@AC-36`, `@AC-51`) are deliberately superseded, signed off by the operator (`context.md`, C-16).

FR-7. The `target_info` join documented in 332 keeps working, including while old unlabelled and new labelled series coexist: its left operand is pre-aggregated with `sum without (host_provider)`. `docs/patterns/observability.md` gains the simple form as the preferred metric query in a guard-tagged block, keeping the join as the fallback and the logs filter unchanged. `scripts/check-otel-produced-signals.py` Part 6 currently requires exactly one promql block (`:368-384`) and asserts the `target_info` matchers (`:502-505`); the feature changes that rule so the simple block and the join block are each checked by their own tag, and the `platform.feature` `@AC-10`/`@AC-12` `@feature-332` scenarios (`:2325`, `:2337`; the tags recur elsewhere, so target the `@feature-332` pair) are extended by new 337 scenarios (`@AC-9`, `@AC-19`, `@AC-20`), promoted at integration with a read-as comment; their promoted text is not edited (C-16).

FR-8. Dashboards and alerts under `packages/otel/` (`dashboards/*.json`, `alerts/*.yaml`) are not edited (they key on `service_name`; provider-scoped alerts remain follow-up `otel-env-provider-scoped-alerts`).

## Out of Scope

- Logs labeling: the Loki OTLP config page is unavailable on the free tier; `| host_provider="homelab"` stays the documented logs filter.
- `service.namespace` or any standard attribute repurposed to carry the provider (operator decision; also 332 `R-6`).
- Dashboard and alert edits, provider-scoped alerts (`otel-env-provider-scoped-alerts`).
- Python `service.instance.id` (feature 336, separate in-flight PR #1527); this feature must not depend on it.
- Changes to `deployment.environment`, `service.name`, `host.name`, or the 332 resource attribute.
- Enabling DO production telemetry.

## Affected Services

- `xstockstrat-trading`, `-portfolio`, `-marketdata` — Go `internal/telemetry/otel.go` plus a new `hostlabel.go`.
- `xstockstrat-config`, `-identity`, `-ledger`, `-notify` — Node `src/telemetry.ts`.
- `xstockstrat-ui` — `src/telemetry.ts`.
- `xstockstrat-analysis`, `-ingest`, `-indicators`, `-agent` — Python `app/telemetry.py`.
- Non-service: `docs/patterns/observability.md`, `scripts/check-otel-produced-signals.py` and its tests, `packages/otel/dashboards/README.md:47` (prose only), and at integration `docs/sdd/business-rules/platform.feature` plus the ui and analysis `acceptance/signal-map-instrumentation.feature` (read-as comments and new scenarios only, no edit to promoted text).

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — operator-facing observability: consumed in Grafana Cloud PromQL by the operator; no `xstockstrat-ui` segment or MCP tool changes (C-14).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. Reuses `HOST_PROVIDER` (deploy-time env, 332); no `WatchConfig` key.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/metrics-host-provider-label` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — per touched service plus Platform Lead
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

All resolved in `/sdd-design` (`design.md`, `debate.md`).

- [x] **Mechanism fork (A/B/C)** — RESOLVED (D-4): option B, a per-runtime exporter wrapper. A is locked rejected (R-4).
- [x] **Free-tier availability of option A** — RESOLVED: not needed; A has no repo-side mechanism and is gated on Grafana Labs Support (R-4).
- [x] **SDK capability per runtime** — RESOLVED from pinned source (`recon.md` Mechanism matrix).
- [x] **Rollout churn** — RESOLVED (D-12, D-20): the relabel forks series identity once; the 332 join is pre-aggregated; `@AC-6` measures from T0 = 2671.

## Constraints carried from the Ledger

- `fails.md` (274 family, 2026-10-21): prove SDK behavior at the pinned version and add a test that fails on the naive assumption.
- `fails.md` (332, 2026-11-11): a shared-value claim cites the pipeline line behind each side.
