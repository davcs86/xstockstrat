# Debate Register: homelab-otel-host-provider

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-design | 8 | 6 | 9 | 13 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Hand-read `HOST_PROVIDER` in each of the 12 resource builders with a small inline normaliser (exact lowercase `digitalocean`/`homelab`, else `unknown`); no shared package; no reliance on `OTEL_RESOURCE_ATTRIBUTES`. Edit sites: Go `newResource` `otel.go:124-132`, Python `_build_resource`, Node `buildResource`, UI `telemetry.ts:44-49`. | recon.md Codebase Map; precedence unverified in all SDKs (recon R-2) | settled |
| D-2 | 1 | The `Authorization=` prefix is one idempotent helper in `scripts/sops_secrets.py`, called by `do-render-app-spec.py:104-107` and by homelab `cmd_resolve` (before `_quoted`); `mask()` lives inside the helper's prefixing branch so both callers inherit it. Supersedes the FR-4 sentence that put the rewrite in `homelab-release-env.sh` (operator acceptance of the FR-4/AC-9 rewording tracked at O-10). | recon.md Patterns to REUSE; `sops_secrets.py:155-158,192-222`; `do-render-app-spec.py:104-107` | settled |
| D-3 | 1 | Do not depend on any Grafana-side attribute-promotion setting for correctness; provider filtering uses the `target_info` join (metrics) and a structured-metadata filter (logs). Verified live: the `(job, instance)` join works for Python and Go (missing label matches empty). | Live Grafana 2026-11-11; recon R-1 | settled |
| D-4 | 1 | Documented queries are checked by extending `scripts/check-otel-produced-signals.sh` (existing CI `otel-signals` job); no promtool/Loki linter and no new parser dependency. | recon.md R-3; `check-otel-produced-signals.sh:131-183` | settled |
| D-5 | 1 | The OTLP `KEYS` rows become `(DO, HOMELAB)` and stay `required=False`; a missing key fails at compose render via `${VAR:?}` (message from `homelab-render-check.sh:15-17`), not in the resolver. `OTEL_RESOURCE_ATTRIBUTES` joins the `owned` regex so no APP_ENV/SOPS value can reach a container. | 302 `@AC-2/@AC-8/@AC-9`; `homelab-release-env.sh:39` | settled |
| D-6 | 1 | User steer at the round-1 gate: homelab STAGING must report `staging`, not `development`. `homelab-release-env.sh:18` staging `appenv` becomes `staging` (TRADING_MODE stays `paper`), with the knock-on edits `render-assert.jq:4`, `homelab-render.test.sh:74` and the `development` half of `@AC-22 @feature-279` (C-16 CHANGE, user directive recorded in context.md). Restores the DO-dev vs homelab-staging same-environment pair, so D-7 is required. | User answer 2026-11-11; `homelab-release-env.sh:18`; grep of all `APPLICATION_ENV` reads: every runtime treats non-`production` as the staging scope (config watchers, identity `isBlockedDefaultAdmin`, UI `deploymentEnv.ts:8`, agent `scopes.py:29`) and DO dev already runs `staging` (`.do/app.dev.yaml:28-29`) | settled |
| D-7 | 1 | Series discriminator is a deterministic `service.instance.id = <host.provider>-<service>` for Go, Node and UI (3+4+1 services); Python keeps its SDK-generated random id. Zero restart churn; unique while there is one replica per service per stack. User chose this option at the gate. | User answer 2026-11-11; recon live facts (Go/Node series have no `instance`; Python has) | settled |
| D-8 | 1 | Homelab staging and production both export (`OTEL_ENABLED=true` for both targets). Paging semantics (alerts have no `deployment_environment` matcher, `alert-rules.yaml:50,96,146`) and the 3-stack series budget (~3,600) are accepted and written into `design.md`; env/provider-scoped alerts are a NAMED FOLLOW-UP feature, not part of 332. | User answer 2026-11-11 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Grafana-side resource-attribute promotion as the sole mechanism | Unversioned stack setting, untestable from the repo; correctness would depend on an operator remembering it (recon R-1) | locked |
| R-2 | 1 | A per-datapoint `host_provider` attribute via metric views | Touches every instrument in 12 runtimes; Go views can only drop attributes and `serverMetricViews` must stay unchanged (`@AC-56 @feature-294`) | locked |
| R-3 | 1 | Shell `sed` rewrite of the `KEY='…'` credential line in `homelab-release-env.sh` | Second implementation of the prefix rule, in shell, on a credential line (quoting fragility, recon R-6) | locked |
| R-4 | 1 | promtool / Loki linter for AC-10/AC-11 | New CI tool for two doc snippets (C-18) | locked |
| R-5 | 1 | `OTEL_RESOURCE_ATTRIBUTES` as the injection mechanism | Precedence unverified and differs per SDK; exact-lowercase-else-`unknown` needs code anyway | locked |
| R-6 | 1 | `service.namespace` per provider so `job` becomes `<ns>/<name>` | Changes `job` on existing DO series, breaks job-keyed queries and adds a second provider encoding | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Premise wrong: homelab staging renders `APPLICATION_ENV=development` (`homelab-release-env.sh:18`, `render-assert.jq:4`, `homelab-render.test.sh:74`, `platform.feature:1196`), so it exports `deployment_environment="development"`, not `staging`; DO dev is `staging` (`.do/app.dev.yaml:28-29`). Spec problem statement, FR-5 examples, AC-10/11/12 and the post-deploy check encode a pair that never exists; real same-environment pairs are homelab staging vs local compose (`development`) and homelab production vs a future DO prod. Operator binding forbids changing `deployment.environment`. (P-03, C-11, C-15; ledger homelab-compose-deploy) | yes | closed @ round 1 (user steer D-6: homelab staging becomes `staging`) |
| O-2 | 1 | Homelab production export and paging scope understated: `OTEL_ENABLED=true` for both targets makes homelab production the first production telemetry in the shared stack; alert exprs (`alert-rules.yaml:50,96,146`) have no `deployment_environment` matcher, so homelab errors page the same alerts with no provider/env label and a live homelab analysis loop suppresses the `noDataState: Alerting` heartbeat for a dead DO dev loop; series budget is up to 3 exporting stacks, not 2 (C-11, P-03) | yes | closed @ round 1 (user decision D-8: both on, alerts follow-up) |
| O-3 | 1 | C-16 CHANGE of `@AC-13 @FR-9 @feature-279` ("OTel is off on the homelab") needs user sign-off recorded in `context.md`; `platform.feature:1196` (staging renders `development`) must stay PRESERVED | no | closed @ round 1 (user sign-off 2026-11-11 for the `@AC-13` CHANGE; the `platform.feature:1196` `development` half is changed by D-6, see O-13) |
| O-4 | 1 | D-6 rollback/mixed-version claim inaccurate: resolve runs from the dispatching workflow ref (`deploy-homelab.yml:118`) before the checkout of the image commit (`:120-122`); old ref + new image fails closed on `:?`; add a manual old-tag path test (ledger 2026-11-04) | no | open |
| O-5 | 1 | "S1 must be deployed before S4b" is spurious: homelab images and `compose.yml` come from the same commit (`deploy-homelab.yml:122`) | no | closed @ round 1 (dropped; restated as "S1 and S4 land in the same image commit") |
| O-6 | 1 | Node `envDetectorSync` (config `telemetry.ts:183`) lets a detected `OTEL_RESOURCE_ATTRIBUTES=host.provider=…` override the normaliser on the 4 Node services | no | closed @ round 1 (D-5: `OTEL_RESOURCE_ATTRIBUTES` added to the `owned` regex; absence kept as a guarded invariant) |
| O-7 | 1 | Credential masking parity: `do-render-app-spec.py:107` masks the prefixed value; a homelab `cmd_resolve` prefix has no equivalent | no | closed @ round 1 (D-2: `mask()` inside the shared helper) |
| O-8 | 1 | `target_info` join labels unverified | no | closed @ round 1 (verified live: `target_info` carries `deployment_environment` and `instance` where set; the `(job, instance)` join returns correct results for Python and Go) |
| O-9 | 1 | Churn understated: random per-process `service.instance.id` creates a new metric series set and a new Loki stream (`service_instance_id` is a stream label) on every restart; DO dev redeploys on every main-dev push; alternative A2 deterministic `<provider>-<service>` id has zero churn | no | closed @ round 1 (user chose deterministic, D-7) |
| O-10 | 1 | AC rewording needs explicit user acceptance (C-15/C-11): AC-9 "When" moves the prefix into `sops_secrets.py resolve`; AC-10/AC-11 become structural "well-formed" checks | no | closed @ round 1 (user accepted AC-9 and AC-10/11 rewording) |
| O-11 | 1 | `target_info` row in `produced-signals.tsv` attributes a Grafana-synthesised series to `otel.go` (misleading) | no | closed @ round 1 (note in the producer-literal column and a line in `observability.md`) |
| O-12 | 1 | Homelab egress to the Grafana OTLP gateway is unverifiable from the repo | no | open |
| O-13 | 1 | Knock-on of D-6 to verify in round 2: nothing besides telemetry may change when homelab staging `APPLICATION_ENV` goes `development` -> `staging` (config watchers `resolve_environment`, Go `config.go`, identity default-admin gate, agent scopes, mTLS/dev-cert logic keyed on environment, the 279/302 acceptance copies, `docs/context-constitution.md`, runbooks that say staging renders `development`); enumerate every touched file and rule | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
