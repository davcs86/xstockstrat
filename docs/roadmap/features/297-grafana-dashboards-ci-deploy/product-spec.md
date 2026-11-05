# Product Spec: grafana-dashboards-ci-deploy

**Created**: 2026-11-05

---

## Problem Statement

The five dashboards under `packages/otel/dashboards/` are the version-controlled source of truth (features 033, 274), but reaching Grafana Cloud still means a manual UI import per file (`docs/setup/grafana-cloud.md` Step 6, `packages/otel/dashboards/README.md` § Importing). Nothing re-applies a merged dashboard change, so the live stack drifts from the repo silently. Developers also cannot query the stack from a Claude Code session without copy-pasting results. PR 653 proposed both fixes in June 2026 but targets `main`, conflicts with the trunk, and predates the changes below.

## User Story

As a platform engineer, I want a merge to `main-dev`/`main` that touches `packages/otel/dashboards/` to upsert those dashboards into Grafana Cloud, so that the repo and the live stack cannot drift and no operator imports JSON by hand.

## Delta Analysis: PR 653 vs. `main-dev` (b371a3e)

PR 653 = 9 files, +346/−2, 3 commits, head `b2ec808`. Nothing from it is on `main-dev` (no `grafana-dashboards.yml`, no `grafana-deploy-dashboards.sh`, no `grafana` entry in `.mcp.json` / `.claude/settings.json`).

| PR 653 piece | State on `main-dev` | Verdict | What changes |
|---|---|---|---|
| `scripts/grafana-deploy-dashboards.sh` (uploader) | Absent | **Carry, with fixes** | Keep: HTTP-API upsert keyed by `uid`, `__inputs`/`__requires` stripped, `id:null`, `overwrite:true`, bash-3.2, env overrides, continue-then-fail on bad files. Fix the gaps G1–G4 below. |
| `.github/workflows/grafana-dashboards.yml` | Absent | **Carry, with fixes** | Keep path filter + `workflow_dispatch`. Fix G5–G7. |
| `packages/otel/dashboards/README.md` "Via CI" para | README exists; now lists 5 dashboards, `DS_TEMPO`, guard rules | **Re-apply** | Paragraph rebased onto the post-274 README; must satisfy otel-signals guard Part 3 (named files must exist). |
| `docs/setup/grafana-cloud.md` Step 6 "Deploy from CI" + secrets table | Step 6 is manual-import only | **Re-apply** | Same; the secrets table must reflect Q2 (GitHub secret vs SOPS). |
| `docs/setup/grafana-cloud.md` Step 9 (MCP) | Absent | **Conditional** on Q3 | |
| `.mcp.json` `grafana` server (docker `mcp/grafana`) | `.mcp.json` now has 7 DigitalOcean HTTP servers; no docker/stdio entry | **Conditional** on Q3 | Image must be pinned (G8). |
| `.claude/settings.json` enable `grafana` | `enabledMcpjsonServers` lists the 7 DO servers | **Conditional** on Q3 | |
| `.env.example` `GRAFANA_URL` / token block + CI-secret table rows | No Grafana-API vars; OTLP vars only | **Conditional** on Q2/Q3 | |
| Root `CLAUDE.md` Key File Paths row | No such row | **Re-apply** | Touching a `CLAUDE.md` triggers the root Teardown (context-forge refresh or manual reconciliation recorded in the PR body). |
| `docs/setup/CLAUDE.md` row tweak | Row for `grafana-cloud.md` exists in older wording | **Re-apply** | Same Teardown. |

### Gaps in PR 653 against current code (each becomes a requirement or an open question)

- **G1 — Tempo datasource not handled.** The script substitutes only `${DS_PROMETHEUS}` and `${DS_LOKI}`. `service-health.json` now declares `DS_TEMPO` in `__inputs` and references `${DS_TEMPO}` 6 times (Tempo panels added by 274). Left unsubstituted it falls back to the dashboard's `DS_TEMPO` datasource template variable, which resolves by whatever Grafana picks for `current: {}` — unverified and non-deterministic. → FR-2.
- **G2 — Datasource auto-discovery picks `.[0]` by type.** A Grafana Cloud stack ships several `prometheus`/`loki` datasources besides the stack's own (usage, alert-state-history, ML-metrics style sources). First-match-by-type can bind panels to the wrong source and still return HTTP 200. → FR-2, Q5.
- **G3 — `overwrite:true` silently reverts UI edits** (`"editable": true` in the dashboards). Drift policy is undecided. → Q6.
- **G4 — No pruning.** A dashboard deleted or renamed (uid change) in the repo stays in Grafana forever; the README's "removed assets" fence (guard Part 3) has no live-stack counterpart. → Q6.
- **G5 — Concurrency is per-ref** (`grafana-dashboards-${{ github.ref }}`), so a `main-dev` push and a `main` push to the same stack/folder can run concurrently and race. → FR-5.
- **G6 — `main-dev` and `main` both write the same folder uid `xstockstrat`.** If dev and prod share one Grafana stack (docs/setup/grafana-cloud.md allows it, separated only by `deployment.environment`), `main-dev` pushes overwrite what `main` deployed. If they use separate stacks, the workflow has no way to choose credentials per branch. → Q1.
- **G7 — Stale/loose workflow hygiene:** `actions/checkout@v6` (repo pins `actions/checkout@3d3c42e5…  # v7.0.1`), no job-level `permissions: contents: read`, and the header comment cites a non-existent `grafana/dashboards/` path (the PR text itself says `packages/otel/dashboards/`). → FR-5, FR-6.
- **G8 — `mcp/grafana` is unpinned** (implicit `:latest`), against the repo's pin-everything convention; needs Docker, so it cannot start in web/remote sessions (this very session had no Docker). → Q3.
- **G9 — Credential home predates feature 286.** PR 653 assumes plain GitHub secrets. Since 286 (launched 2026-11-04) deploy-time secrets resolve from per-environment SOPS files, with platform credentials deliberately left as native GitHub secrets (`DIGITALOCEAN_ACCESS_TOKEN`). Whether a Grafana API token is "platform" or "deploy" class is undecided. → Q2.
- **G10 — Hard failure when secrets are unset** (fork PRs, new clones): every dashboard push goes red. → Q4.
- **G11 — Alerts remain manual.** `packages/otel/alerts/alert-rules.yaml` (3 rules, `${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}` placeholders) and `mute-timings.yaml` are imported by hand; the same CI path could apply them but PR 653 does not. → Q7 (default: out of scope).
- **G12 — No test.** Sibling scripts (`check-otel-produced-signals.sh` + `.test.sh`) ship an offline test; PR 653 verified only by hand against `service-health.json`. → FR-7.
- **G13 — Process:** PR 653 is based on `main`, violating the `claude/*` → `main-dev` rule; close/supersede it once this feature lands.

## Functional Requirements

FR-1. A push to `main-dev` or `main` that changes `packages/otel/dashboards/**`, `scripts/grafana-deploy-dashboards.sh` or the workflow file, or a manual `workflow_dispatch`, upserts every `packages/otel/dashboards/*.json` into the configured Grafana folder, keyed by the dashboard's `uid`, with the folder created if absent.

FR-2. Every datasource placeholder a dashboard declares (`DS_PROMETHEUS`, `DS_LOKI`, `DS_TEMPO`) is replaced with a concrete datasource uid before upload; `__inputs`/`__requires` are stripped; no `${DS_` substring remains in the uploaded payload. The uid comes from an env override (`GRAFANA_PROMETHEUS_DS_UID`, `GRAFANA_LOKI_DS_UID`, `GRAFANA_TEMPO_DS_UID`) or, absent that, from a deterministic discovery rule (default datasource of that type — final rule per Q5), never "first of type".

FR-3. Re-running with unchanged inputs is idempotent: the same uids, no duplicate dashboards, `id` null in every payload.

FR-4. The script fails closed: missing `GRAFANA_URL`/token, missing datasource of a required type, or a non-200 upload exits non-zero and names the offending variable/file; an invalid-JSON file is reported, remaining files still upload, and the exit code is non-zero.

FR-5. Deploys are serialized per target stack: no two runs write the same Grafana folder concurrently, regardless of which branch triggered them.

FR-6. The workflow pins actions as the repo does (`actions/checkout` by SHA), declares `permissions: contents: read`, and passes credentials only via `env:` of the deploy step; the token is never echoed.

FR-7. The script has an offline test (stubbed HTTP, no network) following the `*.test.sh` convention and wired into CI under a path filter, so the transform (placeholder substitution, key stripping, uid/folder envelope) is verified on every change.

FR-8. Operator docs describe the CI path and the manual invocation; every file, workflow and secret name they cite exists, so `scripts/check-otel-produced-signals.sh` still exits 0.

FR-9. _(conditional on Q3)_ A `grafana` MCP server entry lets a local Claude Code session query the stack, with a pinned image reference and Viewer-scope token as the documented default.

## Out of Scope

- Runtime OTLP export (`OTEL_*`, collector) — untouched, as in PR 653.
- Alert rules / mute timing deploy (G11) unless Q7 flips.
- New dashboards or panel changes; dashboards stay as authored by 274.
- Tempo/trace dashboards beyond what already exists.
- Provisioning Grafana Cloud stacks, datasources or service accounts (operator step, documented only).

## Affected Services

None of the 12 registry services change. Touched areas:
- `packages/otel/` — dashboards README, possibly `CLAUDE.md` pointer.
- `scripts/` — new deploy script + test.
- `.github/workflows/` — new workflow; `ci.yml` filter/job for the script test.
- `docs/setup/grafana-cloud.md`, `docs/setup/CLAUDE.md`, root `CLAUDE.md` (context files → Teardown applies).
- `.mcp.json`, `.claude/settings.json`, `.env.example` — only if Q3 = keep.

## Consumer Surface(s)

_Constitution **C-14**._ "Agent" in PR 653 means the **Claude Code developer agent**, not the `xstockstrat-agent` MCP service; do not conflate.

- [ ] **UI** — none.
- [ ] **Agent** — no `xstockstrat-agent` tool added or changed.
- [x] **None** — internal CI/dev tooling. The only consumers are the CI workflow, platform operators (via `workflow_dispatch` / manual script run) and, if Q3 is kept, local Claude Code sessions.

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

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there (FR-9 only if Q3 keeps the MCP).

## Known Traps (Ledger)

- `fails.md` 2026-08-05 `fix-grafana-otel-variables`: CI scripts parsing/transforming files must be tested against real input and use anchored edits, never blind whole-file `sed -i`. The PR 653 script runs `sed` over raw dashboard JSON; FR-7 must test against the real five files, not a fixture, and the design should prefer `jq` for substitution over `sed` on JSON.
- Feature 286 context: workflow jobs bound to a GitHub Environment make env-level secrets shadow caller-passed ones silently; if Q2 binds the deploy job to `staging`/`production`, secret names must not collide.
- Feature 286 context (otel-signals P3-file): `.yaml`/file tokens in observability docs must name real files — a doc sentence like "the SOPS file under `secrets/`" passes, an invented path fails CI.
- Root Teardown: touching `CLAUDE.md`/`docs/setup/CLAUDE.md` requires a context-forge refresh (or a recorded manual reconciliation) before the PR.

## Open Questions

- [ ] **Q1 (blocking) — Target stack(s).** Do dev (`main-dev`) and prod (`main`) share one Grafana Cloud stack (docs allow this) or use two? Options: (a) one stack, deploy **only on `main`**; `main-dev` is `workflow_dispatch`-only; (b) two stacks, per-branch credentials via GitHub Environments `staging`/`production` and a folder per env; (c) one stack, two folders (`xstockstrat-staging`/`xstockstrat-production`) with per-env uids (breaks the stable `xstk-*` uids). Recommendation: (b) if two stacks exist, else (a).
- [ ] **Q2 (blocking) — Credential home.** Plain GitHub secrets (PR 653), GitHub Environment secrets, or the SOPS files from feature 286? Recommendation: GitHub Environment secrets, because the token is CI-only (no DO runtime consumer), so it does not belong in the `sops_secrets.py` KEYS table that drives `do-render-app-spec.py`.
- [ ] **Q3 (blocking) — Keep the Grafana MCP part?** A hosted Grafana connector already exists at account level in claude.ai (it was available in this session), the docker server needs a local Docker daemon, and image/token handling adds surface. Options: drop it (docs-only mention of the hosted connector); keep the `.mcp.json` docker server with a pinned digest; or switch to Grafana's hosted MCP endpoint if one fits `.mcp.json`'s `http` form like the DO servers. Recommendation: split it out; ship dashboards deploy first.
- [ ] **Q4 — Behaviour when secrets are unset.** Fail (PR 653) or skip with a notice (forks, fresh clones)? Recommendation: skip with a `::notice::` on forks/PRs, fail on `main-dev`/`main`.
- [ ] **Q5 — Datasource discovery rule.** Default datasource of the type, name pattern (`grafanacloud-*-prom` / `-logs` / `-traces`), or require explicit env overrides in CI and keep discovery for manual runs only? To be verified against a real stack's `/api/datasources` before design.
- [ ] **Q6 — Drift and pruning policy.** Is `overwrite:true` (UI edits lost) acceptable? Should dashboards removed from the repo be deleted from the folder (managed-folder prune, scoped by a tag such as `xstockstrat`), or only reported?
- [ ] **Q7 — Alerts.** Extend the same job to apply `alert-rules.yaml` + `mute-timings.yaml` via the provisioning API (needs placeholder substitution for `${DS_*_UID}`), or defer to a follow-up feature? Recommendation: follow-up.
- [ ] **Q8 — PR 653 disposition.** Close it as superseded when this feature's PR merges (it targets `main`, is `dirty`), crediting its design in the PR body.
