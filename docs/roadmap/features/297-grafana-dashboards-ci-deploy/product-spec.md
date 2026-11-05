# Product Spec: grafana-dashboards-ci-deploy

**Created**: 2026-11-05

---

## Problem Statement

The five dashboards under `packages/otel/dashboards/` are the version-controlled source of truth (features 033, 274), but reaching Grafana Cloud still means a manual UI import per file (`docs/setup/grafana-cloud.md` Step 6, `packages/otel/dashboards/README.md` § Importing). Nothing re-applies a merged dashboard change, so the live stack drifts from the repo silently. PR 653 proposed this fix (plus a Grafana MCP server, now split out) in June 2026 but targets `main`, conflicts with the trunk, and predates the changes below. Because the OTLP credentials are shared, one stack holds every environment's series, yet only one of the five dashboards filters on `deployment_environment`.

## User Story

As a platform engineer, I want a merge to `main-dev`/`main` that touches `packages/otel/dashboards/` to upsert those dashboards into Grafana Cloud, so that the repo and the live stack cannot drift and no operator imports JSON by hand.

## Delta Analysis: PR 653 vs. `main-dev` (b371a3e)

PR 653 = 9 files, +346/−2, 3 commits, head `b2ec808`. Nothing from it is on `main-dev` (no `grafana-dashboards.yml`, no `grafana-deploy-dashboards.sh`, no `grafana` entry in `.mcp.json` / `.claude/settings.json`).

| PR 653 piece | State on `main-dev` | Verdict | What changes |
|---|---|---|---|
| `scripts/grafana-deploy-dashboards.sh` (uploader) | Absent | **Carry, with fixes** | Keep: HTTP-API upsert keyed by `uid`, `__inputs`/`__requires` stripped, `id:null`, `overwrite:true`, bash-3.2, env overrides, continue-then-fail on bad files. Fix G1–G2 (FR-2); G3–G4 are accepted as documented policy (Q6). |
| `.github/workflows/grafana-dashboards.yml` | Absent | **Carry, with fixes** | Keep path filter + `workflow_dispatch`. G5–G7 are closed via Q1, FR-5 and FR-6. |
| `packages/otel/dashboards/README.md` "Via CI" para | README exists; now lists 5 dashboards, `DS_TEMPO`, guard rules | **Re-apply** | Paragraph rebased onto the post-274 README; must satisfy otel-signals guard Part 3 (named files must exist). |
| `docs/setup/grafana-cloud.md` Step 6 "Deploy from CI" + secrets table | Step 6 is manual-import only | **Re-apply** | Same; the secrets table must name the GitHub Environment holding them (Q2, Q2a). |
| `docs/setup/grafana-cloud.md` Step 9 (MCP) | Absent | **Split out** (Q3 decided 2026-11-05) | Not part of this feature. |
| `.mcp.json` `grafana` server (docker `mcp/grafana`) | `.mcp.json` now has 7 DigitalOcean HTTP servers; no docker/stdio entry | **Split out** (Q3) | Image pinning (G8) moves with it. |
| `.claude/settings.json` enable `grafana` | `enabledMcpjsonServers` lists the 7 DO servers | **Split out** (Q3) | |
| `.env.example` `GRAFANA_URL` / token block + CI-secret table rows | No Grafana-API vars; OTLP vars only | **Re-apply, comment rows only** | List the two CI environment secrets in the existing GitHub-secrets comment block; the MCP env block is split out (Q3). |
| Root `CLAUDE.md` Key File Paths row | No such row | **Re-apply** | Touching a `CLAUDE.md` triggers the root Teardown (context-forge refresh or manual reconciliation recorded in the PR body). |
| `docs/setup/CLAUDE.md` row tweak | Row for `grafana-cloud.md` exists in older wording | **Re-apply** | Same Teardown. |

### Gaps in PR 653 against current code (each becomes a requirement or an open question)

- **G1 — Tempo datasource not handled.** The script substitutes only `${DS_PROMETHEUS}` and `${DS_LOKI}`. `service-health.json` now declares `DS_TEMPO` in `__inputs` and references `${DS_TEMPO}` 6 times (Tempo panels added by 274). Left unsubstituted it falls back to the dashboard's `DS_TEMPO` datasource template variable, which resolves by whatever Grafana picks for `current: {}` — unverified and non-deterministic. → FR-2.
- **G2 — Datasource auto-discovery picks `.[0]` by type.** Confirmed on the live stack (context.md 2026-11-05): 3 `loki` datasources (`grafanacloud-alert-state-history` listed first, then `grafanacloud-logs`, `grafanacloud-usage-insights`) and 2 `prometheus`. First-of-type would bind Loki panels to alert-state-history and still return HTTP 200; "default of the type" does not work either, since only Prometheus has `isDefault` (Loki and Tempo have none). The stack's uids are stable names: `grafanacloud-prom`, `grafanacloud-logs`, `grafanacloud-traces`. → FR-2, Q5.
- **G3 — _(accepted, Q6)_ `overwrite:true` silently reverts UI edits** (`"editable": true` in the dashboards). Drift policy is undecided. → Q6.
- **G4 — _(accepted, Q6)_ No pruning.** A dashboard deleted or renamed (uid change) in the repo stays in Grafana forever; the README's "removed assets" fence (guard Part 3) has no live-stack counterpart. → Q6.
- **G5 — _(closed by Q1 option B)_ Concurrency is per-ref** (`grafana-dashboards-${{ github.ref }}`), so a `main-dev` push and a `main` push to the same stack/folder can run concurrently and race. → FR-5.
- **G6 — _(closed by Q1 option B)_ `main-dev` and `main` both write the same folder uid `xstockstrat`.** If dev and prod share one Grafana stack (docs/setup/grafana-cloud.md allows it, separated only by `deployment.environment`), `main-dev` pushes overwrite what `main` deployed. If they use separate stacks, the workflow has no way to choose credentials per branch. → Q1.
- **G7 — Stale/loose workflow hygiene:** `actions/checkout@v6` (repo pins `actions/checkout@3d3c42e5…  # v7.0.1`), no job-level `permissions: contents: read`, and the header comment cites a non-existent `grafana/dashboards/` path (the PR text itself says `packages/otel/dashboards/`). → FR-5, FR-6.
- **G8 — _(split out, Q3)_ `mcp/grafana` is unpinned** (implicit `:latest`), against the repo's pin-everything convention; needs Docker, so it cannot start in web/remote sessions (this very session had no Docker). → moves with the split-out MCP feature.
- **G9 — Credential home predates feature 286.** PR 653 assumes plain GitHub secrets. Since 286 (launched 2026-11-04) deploy-time secrets resolve from per-environment SOPS files, with platform credentials deliberately left as native GitHub secrets (`DIGITALOCEAN_ACCESS_TOKEN`). Decided 2026-11-05 (Q2): GitHub Environment secrets, not the SOPS KEYS table, since the token has no DO-runtime consumer. → Q2a for which environment.
- **G10 — Hard failure when secrets are unset** (fork PRs, new clones): every dashboard push goes red. → Q4.
- **G11 — _(out of scope, Q9)_ Alerts remain manual.** `packages/otel/alerts/alert-rules.yaml` (3 rules, `${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}` placeholders) and `mute-timings.yaml` are imported by hand; the same CI path could apply them but PR 653 does not. → decided out of scope (Q7).
- **G12 — No test.** Sibling scripts (`check-otel-produced-signals.sh` + `.test.sh`) ship an offline test; PR 653 verified only by hand against `service-health.json`. → FR-7.
- **G13 — Process:** PR 653 is based on `main`, violating the `claude/*` → `main-dev` rule; close/supersede it once this feature lands.

## Functional Requirements

FR-1. A push to `main-dev` (not `main`, per Q1 option B) that changes `packages/otel/dashboards/**`, `scripts/grafana-deploy-dashboards.sh` or the workflow file, or a manual `workflow_dispatch` run on `main-dev`, upserts every `packages/otel/dashboards/*.json` into the configured Grafana folder, keyed by the dashboard's `uid`, with the folder created if absent.

FR-2. Every datasource placeholder a dashboard declares (`DS_PROMETHEUS`, `DS_LOKI`, `DS_TEMPO`) is replaced with a concrete datasource uid before upload; `__inputs`/`__requires` are stripped; no `${DS_` substring remains in the uploaded payload. The uids default to the stable Grafana Cloud names `grafanacloud-prom`, `grafanacloud-logs`, `grafanacloud-traces` and can be overridden by `GRAFANA_PROMETHEUS_DS_UID`, `GRAFANA_LOKI_DS_UID`, `GRAFANA_TEMPO_DS_UID`. The script never selects a datasource by type or list order; it checks that each chosen uid exists (`GET /api/datasources/uid/<uid>`) and fails closed on a 404 before any upload (Q5).

FR-3. Re-running with unchanged inputs is idempotent: the same uids, no duplicate dashboards, `id` null in every payload.

FR-4. The script fails closed: a missing `GRAFANA_URL` or `GRAFANA_SERVICE_ACCOUNT_TOKEN`, a datasource uid that does not exist, or a non-200 upload exits non-zero and names the offending variable, uid or file; an invalid-JSON file is reported, remaining files still upload, and the exit code is non-zero. Neither stdout nor stderr ever contains the token value. Unset secrets fail the job rather than skip it (Q4): only pushes to `main-dev` and manual dispatch trigger it, so no fork or PR path exists.

FR-5. Deploys are serialized per target stack: one constant concurrency group (not keyed on the ref) with `cancel-in-progress: false`, so no two runs write the same Grafana folder concurrently.

FR-6. The new workflow pins `actions/checkout` by SHA as `deploy.yml` does, declares `permissions: contents: read`, runs in the `grafana` GitHub Environment (Q2a), and passes credentials only via `env:` of the deploy step, from GitHub Environment secrets (Q2); the token is never echoed. The added `ci.yml` job follows `ci.yml`'s existing checkout style.

FR-7. The script has an offline test (stubbed HTTP, no network) following the `*.test.sh` convention and wired into CI under a path filter that covers the script and `packages/otel/dashboards/**`, so the transform (placeholder substitution, key stripping, uid/folder envelope) is verified on every change.

FR-8. Operator docs describe the CI path and the manual invocation, state that the script overwrites UI edits and never deletes dashboards removed from the repo (Q6), and state that the `grafana` environment restricts deployment branches to `main-dev`; every file, workflow and secret name they cite exists, so `scripts/check-otel-produced-signals.sh` still exits 0. The same change adds the Key File Paths row in root `CLAUDE.md`, the updated `grafana-cloud.md` row in `docs/setup/CLAUDE.md`, the two environment-secret rows in the `.env.example` GitHub-secrets comment block, and the "Via CI" paragraph in the dashboards README.

FR-9. _Withdrawn 2026-11-05: the Grafana MCP part is split out (Q3). The number is not reused._

FR-10. Each of the four dashboards that lack it (`service-health`, `signal-pipeline-throughput`, `infrastructure`, `trading-service`) declares a multi-select, include-all `environment` variable defaulting to All, and all 15 of their query targets (9 PromQL, 3 LogQL, 3 TraceQL, counted with `jq` on 2026-11-05; `/sdd-design` recon recounts) are scoped by it: `deployment_environment=~"$environment"` for PromQL and LogQL, `resource.deployment.environment =~ "$environment"` for TraceQL. `development` is an ordinary selectable value, never excluded. `service-detail.json` is unchanged. Edited panels keep the stream-method exclusion and the registered series, so the produced-signals guard stays green.

FR-11. _Withdrawn 2026-11-05: alert rules are out of scope (Q9). The number is not reused._

## Out of Scope

- Runtime OTLP export (`OTEL_*`, collector) — untouched, as in PR 653.
- Pruning: dashboards removed or renamed in the repo are not deleted from Grafana (G4, Q6); remove them by hand.
- The Grafana MCP server (`.mcp.json`, `.claude/settings.json`, Step 9 docs, image pinning) — split out per Q3. No follow-up feature number allocated yet; a hosted Grafana connector already covers a single developer's need.
- Alert rules and the mute timing, both their deployment (G11, Q7) and any change to their expressions. They keep aggregating every environment: the residual risk is that `xstk-error-rate-high`, `xstk-p99-latency-high` and `xstk-analysis-no-scoring` cannot tell staging from production (or `development`), accepted by the operator 2026-11-05. A follow-up feature may add per-environment grouping.
- New dashboards or new panels; the only dashboard change is environment scoping (FR-10).
- Tempo/trace dashboards beyond what already exists.
- Provisioning Grafana Cloud stacks, datasources or service accounts (operator step, documented only), including creating the `grafana` GitHub Environment with its two secrets and its `main-dev` deployment-branch rule (not repo-checkable).

## Affected Services

None of the 12 registry services change. Touched areas:
- `packages/otel/` — four dashboard JSONs (FR-10), dashboards README, possibly `CLAUDE.md` pointer; `produced-signals.tsv` only if the guard demands it.
- `scripts/` — new deploy script + test.
- `.github/workflows/` — new workflow; `ci.yml` filter/job for the script test.
- `docs/setup/grafana-cloud.md`, `docs/setup/CLAUDE.md`, root `CLAUDE.md` (context files → Teardown applies).
- `.env.example` — comment rows only.

## Consumer Surface(s)

_Constitution **C-14**._ "Agent" in PR 653 means the **Claude Code developer agent**, not the `xstockstrat-agent` MCP service; do not conflate.

- [ ] **UI** — none.
- [ ] **Agent** — no `xstockstrat-agent` tool added or changed.
- [x] **None** — internal CI/dev tooling. The only consumers are the CI workflow, platform operators (via `workflow_dispatch` / manual script run).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys (Grafana API credentials are CI/dev-time, not `WatchConfig` keys; runtime services never read them — see Q2 for where the secret lives)

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/grafana-dashboards-ci-deploy` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — n/a
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a
- Platform Lead + Security review (new CI credential, new workflow) per `docs/runbooks/reviewer-registry.md`.
- Operator confirmation at the `/sdd-design` gate for the adopted defaults and the Q2a reading: Q2a, Q4, Q5, Q6 (Q8 is a process action, not a spec decision).

Overlap with live features (`/sdd-review` 2026-11-05; no FAIL-level collision, rebase-only):
- `.github/workflows/ci.yml`: 295 (`config-wiring-stored` job) and 281 (`portfolio-db-test`) edit the `changes` filter and `ci-gate` `needs`. This feature adds its own filter key (e.g. `grafana-dashboards`) and its own job (e.g. `grafana-deploy-test`, not appended to the `otel-signals` run line), each with its own `ci-gate` line. Re-anchor by key/job name, not line number, and land after 295 and 281.
- `packages/otel/produced-signals.tsv`: 295 appends two `loki-literal` rows. FR-10 only needs rows if the guard demands them; append at the end and re-run the guard after any rebase.
- Root `CLAUDE.md`: 295 edits § Config Governance Rules, this feature adds a Key File Paths row (disjoint). Run the Teardown refresh once on the final tree after both land.
- No `merge-order.md` row is required.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there. Withdrawn, never reused: FR-9, FR-11, AC-13, AC-17.

## Known Traps (Ledger)

- `fails.md` 2026-08-05 `fix-grafana-otel-variables`: CI scripts parsing/transforming files must be tested against real input and use anchored edits, never blind whole-file `sed -i`. The PR 653 script runs `sed` over raw dashboard JSON; FR-7 must test against the real five files, not a fixture, and the design should prefer `jq` for substitution over `sed` on JSON.
- Feature 286 context: workflow jobs bound to a GitHub Environment make env-level secrets shadow caller-passed ones silently; a deploy job bound to `staging`/`production` would also see that environment's other secrets (e.g. `SOPS_AGE_KEY`); Q2a therefore uses a dedicated `grafana` environment.
- Feature 286 context (otel-signals P3-file): `.yaml`/file tokens in observability docs must name real files — a doc sentence like "the SOPS file under `secrets/`" passes, an invented path fails CI.
- Editing panel queries re-triggers the guard's Part 1 and Part 4 (registered series, proto-derived stream-method exclusion): the stream exclusion must stay in every `rpc_server_duration_milliseconds_*` selector, and FR-7/AC-11/AC-16 must run on the real files, not a fixture.
- Root Teardown: touching `CLAUDE.md`/`docs/setup/CLAUDE.md` requires a context-forge refresh (or a recorded manual reconciliation) before the PR.

## Open Questions

- [x] **Q1 — Target stack(s). DECIDED 2026-11-05: option B (one stack, deploy from `main-dev` only).** Rationale and the options weighed: Evidence (context.md 2026-11-05): OTLP endpoint and headers are shared across environments (`docs/setup/grafana-cloud.md` § 4a), and the one connected stack holds `development` and `staging` series, no `production` in 7d. Options: (A) one stack, deploy from `main` only; (B) one stack, deploy from `main-dev` only (trunk), `main` pushes do not deploy; (C) two stacks with per-environment tokens; (D) one stack, two folders with env-suffixed uids. Recommendation: **B**. Per-environment tokens (C) add no isolation while the stack is shared, and would first need the OTLP headers split; D breaks the stable `xstk-*` uids. Under B the concurrency group is a single constant (closes G5/G6) and staging sees dashboard changes first. Cost: dashboards can query series production has not shipped yet, which only shows empty panels (the produced-signals guard keeps every queried series produced by code on trunk).
- [x] **Q2 — Credential home. DECIDED 2026-11-05: GitHub Environment secrets** (operator), not repo-level secrets and not the SOPS files. Rationale: the token is CI-only with no DO-runtime consumer, so it does not belong in the `scripts/sops_secrets.py` KEYS table that drives `do-render-app-spec.py` (feature 286).
- [x] **Q2a — Which environment? DECIDED 2026-11-05: a dedicated `grafana` environment** (recorded from the operator's "Q2 option A"; confirm that was the intended reading). It holds only `GRAFANA_URL` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`, with deployment branches restricted to `main-dev`. Binding to `staging`/`production` would expose that environment's other secrets (e.g. `SOPS_AGE_KEY`) to this job. An operator must create it; its protection rules are not visible from the repo.
- [x] **Q3 — Grafana MCP part. DECIDED 2026-11-05: split out of this feature** (operator).
- [x] **Q9 — Mixed environments on a shared stack. DECIDED 2026-11-05: folded into this feature as FR-10 (dashboards only); `development` stays a selectable, non-excluded value** (the operator rarely runs the local stack). Only `service-detail.json` filters on `deployment_environment` (8 refs, `$environment` variable). The other four dashboards (0 refs) and all three alert rules (0 refs) aggregate `development`, `staging` and `production`, so a local-dev stack can move the error-rate panels and the critical `xstk-error-rate-high` alert. Pre-existing, not caused by this feature, but deploying makes it visible. Becomes FR-10 (dashboards only). Alert rules were taken out of scope by the operator on 2026-11-05.
- [x] **Q9a — Default selection of the new `environment` variable. DECIDED 2026-11-05: All** (keeps today's behaviour, includes `development`).
- [x] **Q4 — Behaviour when secrets are unset. ADOPTED 2026-11-05 as a default under the operator's review-loop instruction (override welcome): fail the job.** Only `main-dev` pushes and manual dispatch trigger the workflow, so there is no fork or PR path to skip for; FR-4 and AC-7 stand.
- [x] **Q5 — Datasource selection. ADOPTED 2026-11-05 as a default under the operator's review-loop instruction (override welcome): stable uids with env override, no type discovery.** Defaults `grafanacloud-prom`, `grafanacloud-logs`, `grafanacloud-traces` (verified on the live stack), each checked by `GET /api/datasources/uid/<uid>`; a 404 fails closed. This removes the `/api/datasources` list call and the permission question that came with it. Written into FR-2.
- [x] **Q6 — Drift and pruning. ADOPTED 2026-11-05 as a default under the operator's review-loop instruction (override welcome): keep `overwrite:true`, no pruning.** The repo is the source of truth, so UI edits are not durable; the script never deletes, because an automatic delete in a shared stack is the destructive direction. Stated in FR-8, Out of Scope, G3, G4. A prune step can be a follow-up feature.
- [x] **Q7 — Alerts. DECIDED 2026-11-05: out of scope (deploy and edits).** Original question: Extend the same job to apply `alert-rules.yaml` + `mute-timings.yaml` via the provisioning API (needs placeholder substitution for `${DS_*_UID}`), or defer to a follow-up feature? Recommendation: follow-up.
- [x] **Q8 — PR 653 disposition. ADOPTED 2026-11-05 as a default under the operator's review-loop instruction (override welcome): process action, not a spec change.** Close PR 653 as superseded after this feature's PR merges, crediting its design. Not done by this session; it needs the operator's go-ahead.
