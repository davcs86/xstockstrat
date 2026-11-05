# Context: grafana-dashboards-ci-deploy

**Feature**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/implementation-spec.md`

---

## Session 2026-11-05 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from a request to distil PR 653 and compare it with the current code.
- Number `297` reserved with `scripts/sdd-allocate-feature-number.sh` (cursor was at 296). The `/sdd-story` skill text still says local `max+1`; `docs/runbooks/feature-workflow.md` § Feature Numbering (reserved, fail-closed) governs. Skill text is stale — candidate doc fix, not changed here.
- Source: PR 653 `claude/grafana-mcp-availability-tyzn1w` @ `b2ec808`, base `main`, open, `mergeable_state: dirty`, 9 files +346/−2. Read via the GitHub MCP file patches; the head branch itself was not checked out.
- Compared against `main-dev` @ `b371a3e` after `git pull`: none of the PR's files exist there. `packages/otel/dashboards/` now has 5 dashboards (PR assumed the 033 set) and `service-health.json` declares `DS_TEMPO` (6 refs) which the PR's script does not substitute.
- Verified by reading: dashboards' `__inputs`, `uid`s and `${DS_*}` counts; guard `scripts/check-otel-produced-signals.sh` scope (reads `dashboards/*.json`, doc Part 3); checkout pin convention (`actions/checkout@3d3c42e5…  # v7.0.1`); SOPS model (feature 286, launched 2026-11-04); `.mcp.json` now has 7 DigitalOcean http servers.
- NOT verified (flagged in Open Questions): real Grafana Cloud `/api/datasources` composition (G2/Q5), whether an unresolved `${DS_TEMPO}` renders (G1), whether dev and prod share one stack (Q1), whether the Editor-role token can create folders in the target org.
- Decisions deferred to the operator: Q1, Q2, Q3 (blocking); Q4–Q8 (non-blocking).
- Committed on `feature/grafana-dashboards-ci-deploy` and opened as PR davcs86/xstockstrat#1447 into `main-dev`. The "NOT verified" items G2/Q1 above are superseded by the live-stack verification session below.

## Session 2026-11-05 — live-stack verification (read-only, Grafana Cloud connector)

Read-only calls through the claude.ai Grafana Cloud connector (not the PR's docker server): `user_info`, `list_datasources`, `search_dashboards`, `list_prometheus_label_values`.

- **Stack**: one org, `Main Org.` (id 1), identity role Admin, stack slug `davcs86`. `xstockstrat` telemetry is live there: `service_name` on `grafanacloud-prom` (7d) = agent, analysis, config, identity, indicators, ingest, ledger, marketdata, notify, portfolio, trading, ui, plus a stray long-name `xstockstrat-ui` (OTEL-1 keys on short names; not diagnosed here).
- **Environments** on `rpc_server_duration_milliseconds_count` (7d): `development`, `staging`. No `production` series in 7d. So this stack is shared by local-dev and staging; whether production uses another stack or is silent is unknown (Q1).
- **Datasources (13)**: prometheus `grafanacloud-prom` (id 8, **only isDefault=true**) and `grafanacloud-usage` (id 11); loki `grafanacloud-alert-state-history` (id 1), `grafanacloud-logs` (id 7), `grafanacloud-usage-insights` (id 12); tempo `grafanacloud-traces` (id 10, not default). Loki and Tempo have **no default**.
- **Dashboards**: only `xstk-service-health` exists (tagged `xstockstrat`; title search for `xstockstrat` finds the same one). The other four (`xstk-service-detail`, `xstk-signal-pipeline`, `xstk-infrastructure`, `xstk-trading-service`) are not deployed. Its folder was not returned, so whether it sits in `xstockstrat` or General is unverified.
- **Not verified**: the raw `/api/datasources` order the PR script would see (the connector's list is ordered as above, with alert-state-history first among loki); a service account token's ability to create the folder.

## Session 2026-11-05 — operator decisions Q2, Q3; Q1 assessment

- **Q2 decided**: GitHub Environment secrets (operator). Sub-question Q2a opened: which environment. Recommendation: a dedicated `grafana` environment, because a job bound to `staging`/`production` sees that environment's other secrets (feature 286 shadowing trap) and the token is stack-wide, not per-lane.
- **Q3 decided**: Grafana MCP split out (operator). FR-9 and AC-13 withdrawn (IDs not reused); MCP rows in the delta table marked split out. No follow-up feature number allocated yet.
- **Operator input for Q1**: OTLP headers are shared across environments. Consequence: one stack serves all environments, so per-environment Grafana tokens add no isolation. Recommendation recorded in product-spec Q1: deploy from `main-dev` only (option B).
- **New finding (Q9)**: of 5 dashboards only `service-detail.json` filters on `deployment_environment`; the other 4 and all 3 alert rules (`alert-rules.yaml`, 0 refs) aggregate every environment, including `development` series from local stacks.
- Unverified: GitHub Environment protection rules; the Grafana Cloud permissions an Editor token needs for `/api/datasources` (the script may avoid the call by defaulting to the stable uids and verifying each by `GET /api/datasources/uid/<uid>`); whether free-tier Cloud allows a second stack (matters only for option C).

## Session 2026-11-05 — operator decisions Q1, Q2a, Q9

- **Q1 decided**: option B, deploy from `main-dev` only; `main` pushes do not deploy. Closes G5/G6; AC-10 rewritten (single branch, constant concurrency group, `environment: grafana`).
- **Q2a decided**: dedicated `grafana` environment. The operator wrote "Q2 option A"; Q2/Q2a had no lettered options, so this is the first-listed option of Q2a and consistent with the earlier Environment-secrets decision. Flagged in the spec for confirmation.
- **Q9 folded in** (operator): `development` is acceptable as an environment (they rarely run the local stack), so it is a selectable value and nothing is excluded. Scope now includes FR-10 (four dashboards) and FR-11 (alert rules); out-of-scope line "dashboards stay as authored by 274" replaced.
- Grounding for FR-10: 15 query targets across the four dashboards need scoping (service-health 3 PromQL + 1 LogQL + 3 TraceQL; signal-pipeline 1 + 1; infrastructure 2 PromQL; trading-service 3 PromQL + 1 LogQL). `service-detail.json` already scopes Loki with `deployment_environment=~"$environment"`, so a Loki stream-selector precedent exists; whether the label is indexed on the live stack was not checked.
- Grounding for FR-11: `xstk-error-rate-high` and `xstk-p99-latency-high` use `sum by (service_name)` (and `by (le, service_name)`); `xstk-analysis-no-scoring` sums `{service_name="analysis"}` lines over 30m across every environment, so one environment's cycles mask another's stall. Alert rules are applied manually (Q7), so edits do not reach Grafana until re-imported.
- Opened Q9a (blocking for `/sdd-design`): default selection of the variable, group-versus-filter for alerts, stall-rule semantics, manual re-import.
- Not run: `/sdd-review`. Status remains `draft`.

## Session 2026-11-05 — alerts taken out of scope

- Operator: keep alerts out of scope for Q9. FR-11 and AC-17 withdrawn (IDs not reused); `alerts/alert-rules.yaml` and `alerts/README.md` removed from Affected Services; Q7 closed as out of scope; Out of Scope now covers alert deployment and expression changes.
- Accepted residual risk: the three alert rules still aggregate all environments (`sum by (service_name)`, stall rule unscoped), so once production emits alongside staging they cannot tell the two apart. Follow-up feature candidate, not allocated.
- Q9a reduced to one question: default selection of the `environment` variable (recommendation: All).

## Session 2026-11-05 — Q9a decided

- Operator: `environment` variable defaults to All. Pinned in FR-10 and AC-14. Not yet verified: that `deployment_environment` is an indexed Loki label on the live stack (the three LogQL panels depend on it).

## Session 2026-11-05 — sdd-review product-spec, iteration 1 (spec-reviewer)

- Verdict FAIL: B1 (Q4, Q5, Q6, Q8 unresolved), B2 (Q2, Q2a, Q3 entries missing). B2 was this session's own regression: the Q9a edit cut from Q9a to Q4 and swallowed Q2/Q2a/Q3. Restored.
- B1 resolved by adopting the earlier recommendations as defaults under the operator's loop instruction, labelled as overridable: Q4 fail the job; Q5 stable uids with env override, checked by `GET /api/datasources/uid/<uid>`, no type discovery; Q6 overwrite, no pruning; Q8 process action (PR 653 not closed by this session).
- W1/W2/W6 FR-2 and FR-4 rewritten with the rule and variable names; W3 FR-6 cites `deploy.yml` (ci.yml itself uses `@v7`); W4 AC-10 adds `workflow_dispatch`; W5 AC-1/AC-9 assert the token never appears; W7 AC-15 tagged `@manual`; W8 counts annotated as `jq` counts with design recount; N1 withdrawn IDs listed.
- AC-2, AC-3, AC-4, AC-8 rewritten for the uid-based rule (the Q5 default changes their givens).

## Session 2026-11-05 — sdd-review product-spec, iteration 1 (feature-overlap)

- No FAIL-level collision (no shared migration, proto field or config key). Three rebase-only WARNs recorded in product-spec § Feature Workflow Notes: `ci.yml` (295, 281), `produced-signals.tsv` (295, conditional), root `CLAUDE.md` (295). Environment `grafana`, secret name and workflow file name have no other claimant. `packages/otel/dashboards/*` and `alerts/*` are untouched by every live feature.
- Sequencing: land this feature's integration PR after 295 and 281.

## Session 2026-11-05 — sdd-review product-spec, iteration 2

- Verdict PASS WITH WARNINGS, no blockers. Fixed W1 (Delta table G-references), W2 (CI path filter adds `packages/otel/dashboards/**`), W3 (Background serving the three default uids), W4 (AC-10 no `pull_request*` trigger, no secrets-skip guard), W5 (AC-7 now an outline over `GRAFANA_URL` and the token), W6 (FR-8 lists the CLAUDE.md, `.env.example` and README deliverables; AC-12 checks them), N1-N8 wording fixes (N5: environment creation added to the operator preconditions).
- W7 (author-adopted defaults need operator confirmation) cannot be closed by the author: recorded as a `/sdd-design` gate checklist (Q2a, Q4, Q5, Q6) in the product-spec Feature Workflow Notes.

## Session 2026-11-05 — sdd-review product-spec, iteration 3

- Verdict PASS WITH WARNINGS, no blockers. Fixed W1 (AC-12 asserts the `docs/setup/CLAUDE.md` row), N1 (AC-8 Given says "instead returns 404"), N2 (AC-2 drops the Given the Background already states), N3 (G11 cites Q7). W7 stays carried as the `/sdd-design` operator-confirmation checklist.
