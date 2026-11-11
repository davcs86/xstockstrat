# Design: homelab-otel-host-provider

**Created**: 2026-11-11
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-11-11 (round-4 gate)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Internal / operator-facing: the capability is consumed in Grafana Cloud queries by the operator; no UI segment or Agent tool changes (product-spec Consumer Surface = None, C-14). Env/provider-scoped alerts and dashboard selectors are the named follow-up feature `otel-env-provider-scoped-alerts`.

**1. Resource stamp in all 12 runtimes (D-1, D-7).** Each runtime has exactly one resource builder that already feeds the trace, metric and log providers, so one edit per file covers all three signals (recon Codebase Map: Go `internal/telemetry/otel.go:124-132`, one `res` to `:65,73,81`; Python `_build_resource` indicators `app/telemetry.py:24-35`, ingest/analysis `:25-36`, agent `:17-28`; Node `buildResource` config `src/telemetry.ts:29-35`, identity/ledger `:30-36`, notify `:31-37`; UI `src/telemetry.ts:44-49`).
- A small inline normaliser reads `HOST_PROVIDER` and keeps it only when it is exactly `digitalocean` or `homelab`; anything else, including unset, is `unknown`. It has no error path, so it cannot be fatal, and the existing non-fatal init guards stay (UI try/catch `:18,67-69`). It is a pure module-level helper in the style of `metricIntervalOptions`/`logBatchOptions` (UI `telemetry.ts:2,10`), so it is unit-testable. `OTEL_RESOURCE_ATTRIBUTES` is not used (R-5): SDK precedence is unverified and the exact-lowercase rule needs code anyway.
- Go, Node and UI also set `service.instance.id = <provider>-<service.name>` (e.g. `homelab-trading`), computed from the same local `p`; Python keeps its SDK-generated id. Go has no `instance` label today (recon live facts), and with homelab staging now `staging` (D-6) the DO dev and homelab series would otherwise be identical label sets. Go uses `semconv.ServiceInstanceID` if the pinned semconv `v1.25.0` exports it, else `attribute.String("service.instance.id", …)`; Node uses `SEMRESATTRS_SERVICE_INSTANCE_ID` where the pinned semconv exports it; UI uses the string literal (the `'deployment.environment'` precedent at `:47`). Export of the constants is unverified (no module cache / `node_modules`); the wire tests go RED if a name is wrong.

**2. Homelab staging reports `staging` (D-6).** `homelab-release-env.sh:18` staging `appenv` becomes `staging` (TRADING_MODE stays `paper`); `render-assert.jq:4` and `homelab-render.test.sh:74` follow. Every runtime read of `APPLICATION_ENV` already treats any non-`production` value as the staging scope (Go config watchers, Python watchers, Node watchers, UI `deploymentEnv.ts:8`, agent `scopes.py:29`, identity `isBlockedDefaultAdmin` `identityServiceImpl.ts:56-57,170`), and DO dev already runs `staging` (`.do/app.dev.yaml:28-29`), so the only observable change is the intended `deployment_environment` value (plus the unconsumed raw `GetTradingEnvironment.application_env` string, `trading.go:2723`). DB names and roles come from `TARGET_ENV` (`homelab-release-env.sh:16-18`), not `APPLICATION_ENV`.

**3. Delivery pipeline (D-2, D-5, D-13, D-18, D-19, D-22).**
- `scripts/sops_secrets.py:32-33` OTLP `KEYS` rows become `(DO, HOMELAB)` and stay `required=False` (302 `@AC-2/@AC-8/@AC-9` preserved). One idempotent helper adds the `Authorization=` prefix (empty stays empty; an already-prefixed value is unchanged) and calls `mask()` inside its prefixing branch; `do-render-app-spec.py:104-107` calls it and `cmd_resolve` (`sops_secrets.py:212-222`) applies it before `_quoted`. The name constant moves into `sops_secrets`.
- `deploy-homelab.yml` gains `LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT/_HEADERS` in the `secrets[format('{0}_…', env.P)]` form after `:109` (required by `check_legacy … homelab`, `sops-secrets.test.sh:1067`; never `secrets.OTEL_…`, `COMMON_RE :747`).
- `deploy/homelab/compose.yml` `x-common-env` (`:4-8`): `:7` becomes the literal `OTEL_ENABLED: "true"`, add the literal `HOST_PROVIDER: homelab`, and require `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` as `${VAR:?…}` (idiom at `:5,6,8,12,15`). All 12 runtime services merge the anchor (`:47,65,84,105,129,148,170,189,212,239,267,301`); `db-migrator` does not (`:36-41`). Literals mean no `.env` or `APP_ENV` line can change them; a `.env` line reaches a container only through a `${VAR}` reference or an `env_file:`, and neither exists for these keys.
- `homelab-release-env.sh` changes only at `:18` (D-6). The `OTEL_RESOURCE_ATTRIBUTES` owned-regex entry is NOT added (D-19): no input can trigger it (compose has no `env_file:` and never references the variable).
- `render-assert.jq`: `:4` staging `appenv: "staging"`; a value-free `authz` boolean beside `pem` (`:13`); `:22` projection adds `HOST_PROVIDER` and an `otlp` boolean (endpoint non-empty and header starts with `Authorization=`); `:39` inverts to `OTEL_ENABLED != "true" or otlp != true` → `otel:<svc>`; new `host-provider:<svc>` check; all over `$apps` (`:25`, excludes `db-migrator`). Values are never projected and jq stderr is discarded (`homelab-render-check.sh:21`).
- `.do/app.yaml` and `.do/app.dev.yaml` global `envs:` gain `HOST_PROVIDER: digitalocean` after `OTEL_ENABLED` (`:32-33`); `.do/app.yaml` keeps `"false"`. The literal passes `do-render-app-spec.py` (`PLACEHOLDER :21`, `LEFTOVER :25`).
- The guard's Part 4 (`check-otel-produced-signals.sh:424-430`) deploy-spec loop gains `deploy/homelab/compose.yml` and flags `OTEL_RESOURCE_ATTRIBUTES` in all four deploy specs with its own hit tag `AC-22 P4-resattr` (D-22, user decision on O-6); the existing sampler/gRPC-exclusion check now also covers the homelab compose (`AC-17 P4-sampler`, AC-23).

**4. Queries and their guard (D-3, D-4, D-9, D-14, D-15, D-16, D-20).** Provider filtering uses the `target_info` join (Grafana promotes `service.name`→`job`, `service.instance.id`→`instance`, `deployment.environment`→`deployment_environment` to series labels; `host.provider` stays on `target_info`; no stack setting is relied on, R-1). Documented in `docs/patterns/observability.md` under a new heading, in exactly one fence per language, tagged `promql otel-guard:host-provider` and `logql otel-guard:host-provider`:
```promql
sum by (service_name, host_provider) (
  rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", rpc_method!~"<proto-derived stream list, byte-identical to alert-rules.yaml:51>"}[5m])
  * on (job, instance, deployment_environment) group_left (host_provider)
    group by (job, instance, deployment_environment, host_provider) (
      target_info{deployment_environment="staging", host_provider="homelab"}
    )
)
```
```logql
{service_name="analysis"} | deployment_environment="staging" | host_provider="homelab"
```
The `group by` collapses the per-restart `target_info` rows (new `process_pid`/`host_name`; seven distinct rows per Node job in 6 h, verified live) so the join stays one-to-one; joining also on `deployment_environment` makes a production series unable to match a staging row even though homelab staging and production share `instance=homelab-<svc>`. DO dev uses `host_provider="digitalocean"`; homelab production uses `deployment_environment="production"` on both selectors (prose variants). The manual post-deploy check (D-15, AC-12) is inline code outside the guard-tagged fences: `count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"}))` expects at least 11 jobs on an idle stack and 12 after one UI login; run the documented PromQL after one RPC and expect at least one series; `instance` is `homelab-<job>` for the 8 Go/Node/UI jobs; an empty result 5 minutes after a healthy deploy means blocked egress (services still start and pass port-check healthchecks, so the VM does not roll back).
- `check-otel-produced-signals.sh` gains Part 6: extract the tagged blocks (zero or more than one per language is a hit), balance check, `check_expr` (registry + Part 4 `check_streams`), literal join-key and selector checks (`selector_lacks`, a generalisation of `check_streams` keeping its `[ -n "$want_matcher" ] || return 0` short-circuit and the `AC-17 P4` tag in the caller), hit tags `AC-10 P6` / `AC-11 P6`. `packages/otel/produced-signals.tsv` gains one `metric⇥target_info⇥<Go otel.go>⇥host.provider` row (4 columns, no note; the "Grafana-synthesised" note lives in `observability.md`; the row proves the literal exists in one producer, the per-runtime tests are the real guard). Tagged fences must avoid the words `service-health|signal-pipeline|infrastructure|trading-service|service-detail` (the test harness strips matching doc lines) and any numeric "N dashboards / N alert rules" phrase (Part 3).

**5. Implementation outline for `/sdd-spec`** (each code step RED first, P-06; test/code paired, C-08; commands per the repo's own gates, `GOWORK=off` for Go):
- S1 Go ×3 (AC-1, AC-2, AC-19 Go); S2 Python ×4 (AC-1, AC-3, AC-21; RED first confirms where Python's `service.instance.id` comes from, else drop AC-21); S3 Node ×4 (AC-1, AC-4, AC-5, AC-13, AC-19 Node; both `node --test` and the production `tsc` per leaf); S4 UI (AC-1, AC-19 UI; no domain fixture, C-12).
- S5 SOPS credential path, one `Lands with`: `sops_secrets.py`, `do-render-app-spec.py`, `deploy-homelab.yml`, `sops-secrets.test.sh` incl. new case 17 with its own LEGACY list (AC-8, AC-9, AC-17).
- S6 Homelab render (after S5), one `Lands with`: `compose.yml`, `homelab-release-env.sh:18`, `render-assert.jq`, `homelab-render.test.sh` (`base_env` OTLP lines, `:74`→staging, `:81`→`"true"`, case 3 with `OTEL_ENABLED=false` and `HOST_PROVIDER=digitalocean` plus a precondition `grep -qx` for each, case 7 mutates, case 10 old-tag skew), and the `sops-secrets.test.sh` case-8 fixture extension (AC-6, AC-7, AC-14, AC-16, AC-18, AC-20).
- S7 DO specs (AC-15). S8 guard + `observability.md` blocks + TSV row + Part-4 additions, landing together, after S1 (AC-10, AC-11, AC-12, AC-22, AC-23). S9 remaining docs (`sops-secrets.md:9` and the `:138-148` checklist with both `common.OTEL_*` keys required non-empty in both SOPS files, `ci-overview.md:75`, `grafana-cloud.md:173`, dashboards README, UI `CLAUDE.md`, the findings entry for the stale `application_env` comments at `trading.proto:295` and `config.go:31`, no proto edit).
- Integration: C-16 promotion with a "Changed by @feature-332" note on each CHANGE; merge order per `merge-order.md` (after 307; coordinate with 329/331/297).

## Rejected Alternatives

- `R-1` Grafana-side resource-attribute promotion as the sole mechanism — rejected: unversioned stack setting, untestable from the repo.
- `R-2` A per-datapoint `host_provider` attribute via metric views — rejected: touches every instrument in 12 runtimes; Go views can only drop attributes and `serverMetricViews` must stay unchanged (`@AC-56 @feature-294`).
- `R-3` Shell `sed` rewrite of the `KEY='…'` credential line in `homelab-release-env.sh` — rejected: a second implementation of the prefix rule, in shell, on a credential line.
- `R-4` promtool / Loki linter for AC-10/AC-11 — rejected: a new CI tool for two doc snippets (C-18).
- `R-5` `OTEL_RESOURCE_ATTRIBUTES` as the injection mechanism — rejected: precedence is unverified and differs per SDK; exact-lowercase-else-`unknown` needs code anyway.
- `R-6` `service.namespace` per provider so `job` becomes `<ns>/<name>` — rejected: changes `job` on existing DO series, breaks job-keyed queries.
- `R-7` Provider filter by `instance=~"homelab-.*"` with no join — rejected: not uniform across runtimes and excludes Python.

## Open Risks

- [ ] DO rolling deploy overlap: the new container starts before the old stops, so two processes briefly push identical `(job, instance, deployment_environment)` series (not a regression; homelab `compose up` is stop-then-start) — recorded in `observability.md` (S9).
- [ ] Homelab staging and DO dev share the staging OTLP token (rotation or revocation hits both stacks); the token persists in the VM release `.env` and `docker inspect` output, same class as `JWT_SECRET` — S9 docs.
- [ ] Series budget: three exporting stacks (DO dev, homelab staging, homelab production) ≈ 3,600 active series (≈1,200 each, `observability.md` § Cost) plus Python restart churn; free-tier risk waived by the operator.
- [ ] Paging semantics: the three alert rules (`alert-rules.yaml:50,96,146`) have no `deployment_environment`/`host_provider` matcher, so homelab errors page the same alerts, and any live homelab analysis loop masks a dead DO dev loop from the `noDataState: Alerting` heartbeat — accepted (D-8); follow-up feature `otel-env-provider-scoped-alerts` (sequence after 297).
- [ ] Homelab egress to the Grafana OTLP gateway cannot be verified from the repo (operator precondition: outbound HTTPS to the endpoint host, no TLS-intercepting proxy); failure signature is an empty `target_info{host_provider="homelab"}` 5 minutes after a deploy while services are healthy — S9 docs.
- [ ] Rollback/skew (O-4): the resolve step runs from the dispatching workflow ref (`deploy-homelab.yml:118`) before the image-commit checkout (`:120-122`); old ref + new image fails closed at render; new ref + old image is inert (compose has no `env_file:`); rollback restores a self-consistent pair — pinned by `homelab-render.test.sh` case 10.
- [ ] One-time relabel of DO dev Go/Node/UI series and new Loki streams when the instance id ships (old instance-less series go stale); nothing in the repo pins the old shape.
- [ ] `${VAR:?}` means a SOPS file missing either `common.OTEL_*` key now fails every homelab render at the named variable (fails closed; signed off, O-26). Operator confirmed (2026-11-11) that the `DEV_`/`PROD_OTEL_EXPORTER_OTLP_*` repo secrets exist, so the per-key `LEGACY_*` fallback (`sops_secrets.py:163-182`) covers an empty or missing SOPS value and no SOPS bootstrap is needed; a forced bootstrap would re-seed all of `common` and `digitalocean` from the legacy secrets (overwrite risk) and stays a wholesale option only. Operator assumption (2026-11-11): `PROD_` holds the same valid values as `DEV_` (environment parity; staging and production share one Grafana instance), so no blank-value check is needed; if the assumption is wrong the first homelab production render fails closed at the named variable, before anything ships. S9 runbook checklist lists both stores and the narrow `sops set` route.
- [ ] The `mask()` ordering trap (O-27): `resolve()` can print a `::warning::` line before the prefixed-value mask; nothing leaks (the raw value is already masked); case 17 avoids a differing LEGACY value.
- [ ] `host.*` is an OTel semantic-convention namespace; a future semconv attribute named `host.provider` could collide (operator decision stands).
- [ ] The documented PromQL depends on `deployment_environment` being promoted onto the metric series of every homelab runtime (verified live for DO only); if not, the query returns nothing (fails closed) — the AC-12 "run the documented PromQL after one RPC" check is what notices.
- [ ] SDK/semconv behavior is unverified on this host (no Go module cache, Python venv or `node_modules`): the semconv constant names and Python's `service.instance.id` source are confirmed by the RED tests in S1–S4.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every claim cites `recon.md`/`path:line`; unverified SDK facts are labelled and covered by RED tests.
- `C-05` / `F-07` — honored by: `HOST_PROVIDER` and `OTEL_*` are deploy-time env vars like `OTEL_ENABLED`, not config keys; nothing is hardcoded that should come from `WatchConfig`.
- `C-08` / `P-06` — honored by: every code step is RED first and paired with its test (outline above); the steps whose pins fail apart (S5, S6, S8) declare `Lands with`.
- `C-11` — honored by: story → full-mode design (4 rounds) before any implementation write.
- `C-13` — honored by: no domain fixture is needed; inline literals each have one consumer.
- `C-14` — honored by: platform-only; the alerting consumer surface is a named follow-up feature.
- `C-15` — honored by: `acceptance.feature` covers FR-1..FR-8 (AC-1..AC-23), IDs append-only.
- `C-16` — honored by: see Business Rules Touched; all three CHANGEs are signed off in `context.md`.
- `C-18` — honored by: 12 inline normalisers instead of a new package per language (no shared telemetry module exists; the copies are under the jscpd `minTokens` 100 and enforcement is UI-only, `.jscpd.json:4`, `.husky/pre-commit:10-13`); one prefix helper instead of a shell duplicate; compose literals instead of `.env` variables; no promtool.
- `P-01`..`P-05` — honored by: single orchestrator wrote every artifact; proposer/adversary exchanges mediated; decisions logged in `debate.md`/`context.md` as they happened.
- `F-01`, `F-06` — honored by: no migration, no pool change. `F-11` — no Floor breach in any round.

## Business Rules Touched (C-16)

- CHANGE `@AC-13 @FR-9 @feature-279` "OTel is off on the homelab" (`docs/sdd/business-rules/platform.feature` ≈1146-1150) — homelab `OTEL_ENABLED` becomes "true"; "no otel-collector service" stays. Signed off by user @ 2026-11-11 (round-1 gate; `context.md`).
- CHANGE `@AC-22 @FR-6 @feature-279` "APP_ENV cannot change the mode, environment or database names" (`:1196`) — the `development` half becomes `staging`. Signed off by user @ 2026-11-11 (round-1 steer; `context.md`).
- CHANGE `@AC-9 @FR-3 @feature-302` "The release .env built from the flat keys still renders under compose" (`:1525-1530`) — the Given gains the two OTLP lines; a SOPS file without them fails the render. Signed off by user @ 2026-11-11 (round-3 gate; `context.md`).
- EXTEND `@AC-29`, `@AC-8`, `@AC-2 @feature-279` (render-check labels `otel:`/`host-provider:`; pipeline-owned values; required OTLP vars), `@AC-8 @FR-4 @feature-302` (the two `LEGACY_OTEL_*` lines), `@AC-10 @FR-1 @feature-274` and `@AC-1 @FR-1 @feature-171` plus the ten per-service `otel-metrics-logs-export.feature` resource scenarios (`host.provider` added; `trading_mode` stays absent), `@AC-17 @feature-274` (guard Part 4 now covers `deploy/homelab/compose.yml`).
- PRESERVE `@AC-2 @FR-3 @feature-302` (exact APP_ENV set; OTLP rows stay `required=False`), `@AC-13/@AC-14 @FR-7 @feature-302`, `@AC-28`, `@AC-1`, `@AC-3`, `@AC-35`, `@AC-36`, `@AC-43 @feature-279`, the 286 DO-resolution rules, `@AC-1 @feature-287`, `@AC-5 @feature-266`, `@AC-4 @FR-4 @feature-226`, the telemetry guards (init never blocks startup, disabled is a no-op, flush on shutdown, `serverMetricViews` unchanged `@AC-56 @feature-294`, RPC metric names unchanged, three-signal docs statement) and Go health gated on init (`@AC-17 @feature-279` in `xstockstrat-trading/acceptance/homelab-compose-deploy.feature`).
