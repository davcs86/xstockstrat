# Product Spec: metrics-host-provider-label

**Created**: 2026-11-12

---

## Problem Statement

Feature 332 stamps `host.provider` on every resource, but Grafana Cloud Mimir keeps it only on `target_info`; metric series carry `job`, `instance`, `deployment_environment`, `service_name`, `service_instance_id` plus their own attributes. Provider-scoped metric queries need `* on (job, instance, deployment_environment) group_left (host_provider) group by (...) (target_info{...})` (`docs/patterns/observability.md` § "Separating DO and homelab"). DO dev and homelab staging both report `deployment_environment="staging"` on one stack, so the operator filters by provider constantly and the join is error-prone and costly to write.

## User Story

As an operator comparing homelab and DO on one Grafana Cloud stack, I want `host_provider` as a label on every metric series, so that I can write `rpc_server_duration_milliseconds_count{host_provider="homelab"}` without a `target_info` join.

## Functional Requirements

FR-1. After deploy, every metric series exported by the 12 runtimes (Go: trading, portfolio, marketdata; Node: ledger, identity, notify, config; Next.js: ui; Python: analysis, ingest, indicators, agent) carries a `host_provider` label in Grafana Cloud Mimir with a value in `homelab` | `digitalocean` | `unknown`, queryable with no `target_info` join. This includes `rpc_server_duration_milliseconds_*`, `rpc_client_*`, and runtime/process families, not only RPC histograms.

FR-2. The label value is the one already resolved for the `host.provider` resource attribute (feature 332 normaliser: exact lowercase, unset/unrecognised → `unknown`). No second reader of `HOST_PROVIDER` and no second normaliser per runtime.

FR-3. Applying the mechanism never prevents startup: any failure resolves to the pre-feature behavior (no label), is logged once, and is not fatal (OTel init errors must never prevent startup).

FR-4. The mechanism is chosen by evidence in `/sdd-design` from options A (Grafana-side `MimirOTLPConfiguration` promotion), B (SDK-side datapoint attribute) and C (status quo). The spec fixes the outcome, not the mechanism. Any option that needs a paid tier, a Grafana Labs support ticket, or an operator-run CLI step is flagged to the operator as a fork before it is adopted.

FR-5. Series cost is bounded and recorded: the added label must not raise active series beyond the budget in `docs/patterns/observability.md` (§ cost), which is updated with the measured delta. A `host_provider` label on a single-sender series adds zero series; the design measures this rather than assuming it.

FR-6. Existing contracts are preserved: the `host.provider` resource attribute and `target_info` row from 332, the logs filter `| host_provider="homelab"`, `service.instance.id` rules, `serverMetricViews` (`@AC-56 @feature-294`), and the metric-label allowlist tests (e.g. UI `src/lib/__tests__/bffAllowlist.test.ts`, per-service telemetry tests) stay green or change only with an explicit allowlist entry for `host_provider`.

FR-7. The `target_info` join documented in 332 keeps working. `docs/patterns/observability.md` gains the simple form as the preferred metric query in a guard-tagged block, keeping the join as the fallback and the logs filter unchanged. `scripts/check-otel-produced-signals.py` Part 6 currently requires exactly one promql block (`:368-384`) and asserts the `target_info` matchers (`:502-505`); the feature changes that rule so the simple block and the join block are each checked by their own tag, and `platform.feature` `@AC-10`/`@AC-11` `@feature-332` (`:2325`, `:2331`; the tags recur elsewhere, so target the `@feature-332` pair) are EXTENDed, not replaced (C-16).

FR-8. Dashboards and alerts under `packages/otel/` are not edited (they key on `service_name`; provider-scoped alerts remain follow-up `otel-env-provider-scoped-alerts`).

## Out of Scope

- Logs labeling: the Loki OTLP config page is unavailable on the free tier; `| host_provider="homelab"` stays the documented logs filter.
- `service.namespace` or any standard attribute repurposed to carry the provider (operator decision; also 332 `R-6`).
- Dashboard and alert edits, provider-scoped alerts (`otel-env-provider-scoped-alerts`).
- Python `service.instance.id` (feature 336, separate in-flight PR #1527); this feature must not depend on it.
- Changes to `deployment.environment`, `service.name`, `host.name`, or the 332 resource attribute.
- Enabling DO production telemetry.

## Affected Services

- `xstockstrat-trading`, `-portfolio`, `-marketdata` — Go `internal/telemetry/otel.go` (only if option B).
- `xstockstrat-config`, `-identity`, `-ledger`, `-notify` — Node `src/telemetry.ts` (only if option B).
- `xstockstrat-ui` — `src/telemetry.ts` (only if option B).
- `xstockstrat-analysis`, `-ingest`, `-indicators`, `-agent` — Python `app/telemetry.py` (only if option B).
- Non-service: `docs/patterns/observability.md`, `scripts/check-otel-produced-signals.py`, `docs/sdd/business-rules/platform.feature` (AC-10/AC-11 CHANGE/EXTEND, C-16), and for option A only, an operator-applied Grafana Cloud setting plus a documented, versioned config file.

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

All five are deferred to `/sdd-design` recon (owner: Platform Lead); each is checked off with the decision recorded in `design.md`, not here.

- [x] **Mechanism fork (A/B/C)** — DEFERRED to `/sdd-design`: operator decides after recon; 332 locked R-1 and R-2 as rejected, this feature reopens both at the operator's request and the design must answer their recorded reasons.
- [x] **Free-tier availability of option A** — DEFERRED to `/sdd-design` recon (Grafana docs: `MimirOTLPConfiguration` self-service is "experimental, contact Grafana Labs Support"; live check 2026-11-12 shows no `host_provider` on metric series).
- [x] **Python/Node/UI/Go SDK capability** — DEFERRED to `/sdd-design` recon: read the pinned SDK sources, not memory.
- [x] **Rollout churn** — DEFERRED to `/sdd-design`: adding a label forks series identity once per runtime on first deploy (old series go stale in about 5 minutes); design records the acceptable window.

## Constraints carried from the Ledger

- `fails.md` (274 family, 2026-10-21): prove SDK behavior at the pinned version and add a test that fails on the naive assumption.
- `fails.md` (332, 2026-11-11): a shared-value claim cites the pipeline line behind each side.
