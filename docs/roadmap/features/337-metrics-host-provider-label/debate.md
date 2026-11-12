# Debate Register: metrics-host-provider-label

**State**: in-debate
**Mode**: full (upgraded from quick at the post-recon P-04 gate, 2026-11-12)
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 0 | 2026-11-12 | operator brief + product-spec | 3 | 2 | 0 | 0 | 0 | seed |
| 1 | 2026-11-12 | /sdd-design | 8 | 3 | 15 | 16 | 0 | yes |
| 2 | 2026-11-12 | /sdd-design | 5 | 0 | 11 | 12 | 2 | yes |

## Settled Decisions

| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 0 | Metrics only. The logs filter `\| host_provider="homelab"` and the 332 resource attribute / `target_info` row are unchanged. | Operator brief; product-spec Out of Scope, FR-6 | settled |
| D-2 | 0 | The label value is the already-resolved 332 `host.provider` (exact lowercase, else `unknown`); no second reader of `HOST_PROVIDER`, no new env var, no config key. | product-spec FR-2; recon.md Dependencies | settled |
| D-3 | 0 | Dashboards and alerts under `packages/otel/` are not edited; provider-scoped alerts stay with `otel-env-provider-scoped-alerts`. This feature must not depend on or edit feature 336 (Python `service.instance.id`). | Operator brief; product-spec FR-8, Out of Scope | settled |
| D-4 | 1 | Mechanism: a metric-exporter wrapper per runtime that adds datapoint attribute `host.provider` (Mimir label `host_provider`) just before the real OTLP exporter. No View, no `serverMetricViews` change, no record-time attribute. Adversary verified against pinned source: Go embedding satisfies `sdkmetric.Exporter` (reader asserts nothing beyond the 5 methods, `config.go:38`, `meter.go:819`), Node binds selectors at reader construction (`PeriodicExportingMetricReader.js:32-33`), Python reader reads `_preferred_*` (`export/__init__.py:434-435`). | recon.md Mechanism matrix; adversary round 1 | settled |
| D-5 | 1 | FR-3 covers export, not just construction: each wrapper's per-export transform is guarded (Go `recover`, Node/Python try/except); on failure warn once and delegate the original, unlabelled batch. One test per runtime family forces the transform to throw and asserts an unlabelled export still arrives. | O-1; `export/__init__.py:520-524`, `PeriodicExportingMetricReader.js:53-63`, `periodic_reader.go:262` | settled |
| D-6 | 1 | One read of the provider: Go hoists `p := hostProvider()` in `Init` and passes it to `newResource` and the wrapper; Node/UI/Python build the resource once and read `host.provider` from it. Wire tests assert datapoint value == exported resource value. | O-11; sdk-node merge order `sdknode218 sdk.js:198`, `sdknode052 sdk.js:124` | settled |
| D-7 | 1 | Scenario rewordings (IDs kept, recorded here and in context.md): @AC-2 When = exported through the real init pipeline and decoded from the OTLP body (not an in-memory reader); @AC-3 = config's real non-RPC instruments (`config.listener_up`, `config.watch.terminated`), not "process/runtime families"; FR-1 drops `rpc_client_*` (absent by contract, `@AC-56 @feature-294`); @AC-6 measured at steady state after the active-series idle window with a defined query per stack and pass = delta about 0 and below the 10,000 cap; @AC-1 and the new guarded block carry `deployment_environment="staging"`, `host_provider="homelab"` and the stream matcher on every rpc selector. | O-2..O-5; `platform.feature:1385`, `check-otel-produced-signals.py:232-237,389` | settled |
| D-8 | 1 | Wrapper correctness requirements, each with a RED test: Go indexes `s.DataPoints[i].Attributes = ...` (a `for _, dp := range` is a silent no-op) and the 8-type table test fails on the range-copy; a datapoint already carrying `host.provider=x` ends with exactly one key holding the wrapper's value in all runtimes; Node binds `inner.selectX?.bind(inner)` and a wire test sets `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` and asserts delta survives; Python forwards `**kwargs` verbatim and a test calls `reader.shutdown()` through the wrapper; the Go safety citation is the aggregators' per-collect reassignment (`internal/aggregate/sum.go:114,250,291`, `histogram.go:205,386`, `lastvalue.go:124`), not only `periodic_reader.go:247-251`. | O-7..O-10; fails.md 274 family | settled |
| D-9 | 1 | Gating smoke test first: push one labelled datapoint to the staging OTLP gateway and query the `host_provider` label (including when a same-named resource attribute exists) before the 12-runtime rollout. Steps: Go, Node leaves, UI (own step), Python, docs/guard/rules, with the smoke test as step 1. | O-14; fails.md:3473 | settled |
| D-10 | 1 | Docs: `observability.md:60,67-68` prose and the cost line are rewritten and listed in the docs step; every new literal is run against Part 3 count/name checks (`check-otel-produced-signals.py:313-350`) and the guard runs on the full post-change tree. Citations corrected: DO dev is `.do/app.dev.yaml:32-35`, homelab `deploy/homelab/compose.yml:7-8`, `.do/app.yaml:32-33` is prod (`OTEL_ENABLED=false`). | O-6, O-15; fails.md:3259, 3988 | settled |
| D-11 | 1 | Operator sign-off (round-1 gate, 2026-11-12): CHANGE `@AC-41 @FR-15`, `@AC-36 @FR-11` and `@AC-51 @FR-5` of feature 294 by appending 'apart from the platform-wide `host.provider` export label (feature 337), added after aggregation'. Instrument-level key sets and their allowlist tests stay unchanged. Recorded in context.md. | User answer at the round-1 gate; O-16 | settled |
| D-12 | 2 | The documented 332 join block pre-aggregates the left operand: `sum without (host_provider) (rate(rpc_server_duration_milliseconds_count{...}[5m])) * on (job, instance, deployment_environment) group_left (host_provider) group by (...)(target_info{...})`. Reason: after the wrapper, for about 5 minutes per stack the old unlabelled and new labelled series (same `instance`) both match, and `group_left` yields two identical label sets, which Mimir rejects. It still contains both `PROMQL_JOIN` substrings, so the guard and `@AC-10 @feature-332` stay valid. RED test: an unlabelled and a labelled sample of the same series give one result row; the post-deploy step runs the join over a range spanning the rollout. | O-17; `observability.md:78-86`, `check-otel-produced-signals.py:49-52` | settled |
| D-13 | 2 | Acceptance corrections (IDs kept; applied at approval): @AC-1 queries `sum by (host_provider) (rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", service_name="trading", <MATCHER>}[5m]))` with no provider matcher 10 minutes after deploy and expects exactly the real providers, none with an empty `host_provider`; @AC-10 uses the 10 gRPC services (3 Go, 4 Node, analysis, ingest, indicators) plus a UI check on `http_server_duration_milliseconds_count{deployment_environment="staging", host_provider="homelab", service_name="ui"}` (the UI has no gRPC server, `bffMetrics.ts:38`), and notes the agent is covered by wire tests; @AC-6 measures the cap with the Grafana usage series (`grafanacloud_instance_active_series`, including the idle-window peak) and a deterministic delta leg (`count by (service_name)(...{host_provider=""})` is 0 at T+30; with-and-without-label counts equal at one instant), recording raw numbers instead of a 5% band; @AC-17 uses different values (resource `host.provider="unknown"`, datapoint `"homelab"`) and expects exactly one series with `host_provider="homelab"` and label names containing `host_provider` with no `host.provider`, and step 1 states the header form (`OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20...`) and records that the `smoke` environment will show in `$environment` dashboard variables for a time; @AC-13 is tagged `@FR-1 @FR-6`; @AC-17 drops `@FR-4` (FR-4 stays covered by @AC-12). | O-20..O-23, O-28 | settled |
| D-14 | 2 | Node fail-open seam: force the failure with a `ResourceMetrics` whose `scopeMetrics` getter throws and assert the fake inner exporter receives that identical object; no private export of `labelled` is needed. | O-24 | settled |
| D-15 | 2 | `packages/otel/dashboards/README.md:47` is rewritten in the docs step (the "only on target_info" statement); the FR-8/`@AC-11` gate narrows to `packages/otel/dashboards/*.json` and `packages/otel/alerts/*.yaml`. Guard rows for the new rule are named with the feature (`337-AC-9 P6`) because feature 332 already has its own `@AC-9`. | O-25, O-26 | settled |
| D-16 | 2 | Citations are per leaf (each Node leaf cites its own `buildResource` and exporter lines; `otel_test.go:69` exists in all three Go services; `test_ac42_failing_init_still_lets_the_service_start` raises at exporter construction and is preserved as such). O-13 closes on the recorded YAGNI trade-off (no `.jscpd.json` change: jscpd is enforced only on `services/xstockstrat-ui/src`, `.husky/pre-commit:13,18`), with test scope per P-2. | O-27, O-13 | settled |

## Rejected Alternatives (locked)

| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 0 | Carry the provider in `service.namespace` or any repurposed standard attribute | Operator decision; it changes `job` on existing series; also rejected in feature 332 `R-6` | locked |
| R-2 | 0 | Use `OTEL_RESOURCE_ATTRIBUTES` as the carrier | The deploy-spec guard rejects it (`@AC-22 @feature-332`, `check-otel-produced-signals.py:444-445`); precedence unverified per SDK | locked |
| R-3 | 1 | UI-only wildcard view with `attributesProcessors` (sdk-metrics 2.7) | Two mechanisms in one runtime family for no gain; it would also enter `bffAllowlist.test.ts:98-102` | locked |
| R-4 | 1 | Option A (Grafana-side `MimirOTLPConfiguration` promotion) as the adopted mechanism now | Not appliable or testable from the repo; gated on Grafana Support and unverified free-tier access; affects new data only. Kept as a documented later simplification (delete the wrappers in the same change; never run both) | locked |
| R-5 | 1 | Keep the three `@feature-294` sentences as PRESERVE by reinterpreting them as instrument-level | The Grafana-observable label set changes; C-16 forbids a silent reinterpretation. Only an explicit operator endorsement could revisit this | locked |

## Objections

| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | FR-3/@AC-5 fail-open covers construction only; a throwing per-export transform drops every batch (a worse outcome than no label). Adopted as D-5. | yes | closed @ round 1 (D-5) |
| O-2 | 1 | @AC-2 says "in-memory reader", which by design never sees the label (C-15). Adopted as D-7. | yes | closed @ round 1 (D-7) |
| O-3 | 1 | @AC-3/FR-1 promise families that do not exist (config process/runtime metrics; `rpc_client_*`) (P-03, C-15). Adopted as D-7. | yes | closed @ round 1 (D-7) |
| O-4 | 1 | @AC-6 pass condition and T+10 timing fail on their own (budget counts only duration families; old series stay active past 5 min). Adopted as D-7. | yes | closed @ round 1 (D-7) |
| O-5 | 1 | New guarded block misses the stream matcher and `deployment_environment` (leaks homelab production rows). Adopted as D-7/D-10. | yes | closed @ round 1 (D-7) |
| O-6 | 1 | `observability.md:60,67-68` prose becomes false and is not in the plan. Adopted as D-10. | no | closed @ round 1 (D-10) |
| O-7 | 1 | Go in-place safety cited on the wrong lines (aggregator reassignment is the real guarantee); must index, not range-copy. Adopted as D-8. | no | closed @ round 1 (D-8) |
| O-8 | 1 | `attribute.NewSet` duplicate-key dedup unproven; test same-key overwrite in all runtimes. Adopted as D-8. | no | closed @ round 1 (D-8) |
| O-9 | 1 | Node selector forwarding must `.bind(inner)`; prove with a delta-preference wire test. Adopted as D-8. | no | closed @ round 1 (D-8) |
| O-10 | 1 | Python `shutdown(timeout=...)`: forward `**kwargs` verbatim; test `reader.shutdown()`. Adopted as D-8. | no | closed @ round 1 (D-8) |
| O-11 | 1 | "Read back from the built resource" diverges from what Node exports (detector merge wins); build once / hoist `hostProvider()` in Go. Adopted as D-6. | no | closed @ round 1 (D-6) |
| O-12 | 1 | C-18: one Node+UI step mixes two SDK majors and two owners; split the UI. Adopted as D-9. | no | closed @ round 1 (D-9) |
| O-13 | 1 | C-18: `.jscpd.json` ignores are not needed to pass (Go/Python/Node are report-only; existing larger copies have none). | no | closed @ round 2 (D-16) |
| O-14 | 1 | Label ingestion (datapoint `host.provider` alongside a same-named resource attribute) unproven before code lands; make step 1 a gating smoke test. Adopted as D-9. | no | closed @ round 1 (D-9) |
| O-15 | 1 | Wrong DO dev citation (`.do/app.yaml` is prod); shared-value trap. Adopted as D-10. | no | closed @ round 1 (D-10) |
| O-16 | 1 | C-16: the three `@feature-294` sentences (`platform.feature:1346`, ui `signal-map-instrumentation.feature:29/34`, analysis `signal-map-instrumentation.feature:36`) are real CHANGEs under option B; needs the operator's explicit sign-off recorded in context.md before approval. | yes | closed @ round 1 (D-11, user sign-off) |
| O-17 | 2 | C-16 regression `@AC-12 @FR-7 @feature-332` / FR-6: the documented 332 join errors for ~5 minutes per stack after the first labelled deploy (duplicate result label sets) and for any range query spanning the rollout. | yes | closed @ round 2 (D-12) |
| O-18 | 2 | C-16 mechanism: Part 4 hand-edits promoted scenario text (suite headers say "Verbatim; do not edit by hand"; `scenario-promoter.md:53` forbids rewriting; precedent is a supersede comment, `platform.feature:17-21,682-686,1447-1457`). | yes | open (P-1 pending user) |
| O-19 | 2 | C-10: 11 independent wrapper copies but most behaviours are tested in one copy per family (a missed `.bind(inner)` or `**kwargs` forward in one service ships unnoticed). | no | open (P-2 pending user) |
| O-20 | 2 | C-15: @AC-1's last Then cannot fail (the query already filters the provider). | no | closed @ round 2 (D-13) |
| O-21 | 2 | C-15: @AC-10 names services that cannot appear (UI emits no rpc series) and omits the three Python gRPC services. | no | closed @ round 2 (D-13) |
| O-22 | 2 | C-15/P-03: @AC-6 measures an instant count, not Grafana's active-series figure, across a gap of days. | no | closed @ round 2 (D-13) |
| O-23 | 2 | fails.md:3473: @AC-17 uses equal values, so it cannot see precedence; header form unstated. | no | closed @ round 2 (D-13) |
| O-24 | 2 | C-08/P-06: Node has no stated way to force the fail-open path. | no | closed @ round 2 (D-14) |
| O-25 | 2 | Doc truth: `packages/otel/dashboards/README.md:47` goes stale and the step-6 diff gate would block fixing it. | no | closed @ round 2 (D-15) |
| O-26 | 2 | Guard row ID `AC-9 P6` collides with feature 332's `@AC-9`. | no | closed @ round 2 (D-15) |
| O-27 | 2 | P-03 accuracy: several citations are per-leaf or wrong (`:188` vs `:189`, `otel_test.go:69` in all three Go services, the ac42 test's real behaviour). | no | closed @ round 2 (D-16) |
| O-28 | 2 | Tag hygiene: @AC-13 `@FR-2`, @AC-17 `@FR-4`, and product-spec FR-1 still names `rpc_client_*` / runtime families. | no | closed @ round 2 (D-13) |

## Reopen Petitions

| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-11 (placement only; the CHANGE and its sign-off stand) | Promoted suites say "Verbatim; do not edit by hand" (`services/xstockstrat-ui/acceptance/signal-map-instrumentation.feature:1`, `services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature:1`); `.claude/agents/scenario-promoter.md:53` "Never delete or rewrite an existing promoted scenario"; precedent supersede comments `platform.feature:17-21,682-686,1447-1457`. Round 1 decided whether and what to change, not where the wording lives. | pending user |
| P-2 | 2 | D-5 / D-8 (test scope: one per family becomes one per copy) | O-13 resolution fixes 11 independent copies and jscpd is report-only outside the UI (`.husky/pre-commit:18`, `scripts/check-duplication.py:53-67`); D-5/D-8 were settled while O-13 was open and assumed nothing about shared code. | pending user |
