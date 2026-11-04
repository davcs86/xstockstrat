# Implementation Spec: fix-deploy-wait-loop

**Status**: `pending`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/288-fix-deploy-wait-loop/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-deploy-wait-loop`

---

## Execution Summary

SEV-3 CI-workflow bug (Track C, design depth `skip` per triage; no `recon.md`/`design.md` exist, so discovery was done
inline). Two defects compound (defect report § Root cause): the "Wait for deployment" loop in the reusable
`.github/workflows/deploy.yml` has no branch for the terminal DO phase `SUPERSEDED`, and nothing serialises deploys to one
DO app. The fix adds the missing branch and a job-level `concurrency` group. No proto, migration, config key, env var or
port changes; no runtime service is touched. The feature-286 SOPS steps (`resolve-app-id`, `setup-sops`, `render`) are not
edited.

Both fixes land in `deploy.yml` only: it is the single reusable workflow called by `deploy-dev.yml:43-51` and
`deploy-prod.yml:42-50`, so neither caller changes.

Ordering is test-first, one RED/GREEN pair per behavior, both pairs in the existing `group_deploy` of
`scripts/sops-secrets.test.sh` (the CI `sops-secrets` job already runs it on any `.github/workflows/deploy*.yml` change):

- Step 1 [test, RED] then Step 2 [service, GREEN]: SUPERSEDED ends the loop (AC-1).
- Step 3 [test, RED] then Step 4 [service, GREEN]: `concurrency` group on the `deploy` job (AC-2).
- Step 5 [docs]: one sentence in `docs/patterns/ci-overview.md`.

**Consumer surface**: `None — internal/platform-only` (CI workflow; no UI, agent tool or service behavior).

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` SUPERSEDED ends the wait loop immediately | Step 1 (test), implemented by Step 2 |
| `@AC-2` Two quick pushes deploy one at a time | Step 3 (test), implemented by Step 4 |

AC-2 is a runtime GitHub Actions behavior that no hermetic test can execute. Step 3 pins the configuration that produces it
(group name, `cancel-in-progress: false`); the runtime behavior itself is observed after merge (Step 4 verification, last
bullet).

## Decisions and Open Questions

- **D-1 (decided here, flagged for review): SUPERSEDED exits 0 with a `::warning::`.** Rejected: exit 1 with a distinct
  message. The reported defect is a falsely red run for a healthy app; a newer deployment of the same app took over, and its
  own run reports its outcome. Residual risk: a deployment superseded by a newer one created outside CI (console, manual
  `doctl`) reports green here. Accepted because `concurrency` (Step 4) removes the CI-internal source of supersession.
  context.md (triage) recorded the same lean; confirm at `/sdd-review impl-spec`.
- **D-2: `cancel-in-progress: false`.** Mirrors `deploy-homelab.yml:54-56`. GitHub keeps one pending job per group and
  cancels older pending ones; a cancelled (grey) run is the expected outcome for a deploy overtaken by a newer push, not a
  failure. `true` was rejected: it would abort a deployment already in flight.
- **Open (not fixed here): `prod-up.yml:93-109` has the same wait loop** with no `SUPERSEDED` branch (it breaks out on
  `ACTIVE`, exits 1 on `ERROR`/`CANCELED`, and simply falls through after 60 polls). It is outside this feature's stated
  scope (product-spec § Affected Services lists `deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml`) and is serialised by
  `concurrency: prod-lifecycle` (`prod-up.yml:19`). Surfaced for a follow-up decision, not edited.
- **Out of scope, unchanged:** `DEPLOY_ID` resolution via `list-deployments | head -1` (product-spec § Out of Scope).

## Step Dependencies

- Step 1 [test] covers Step 2 [service]; Step 1 runs first and must be RED on the unmodified tree (P-06).
- Step 3 [test] covers Step 4 [service]; Step 3 runs first and must be RED on the tree after Step 2.
- Step 2 requires Step 1; Step 3 requires Step 2 only because both edit `scripts/sops-secrets.test.sh` / `deploy.yml` and
  must apply in order; Step 4 requires Step 3.
- Step 5 requires Steps 2 and 4 (it documents both behaviors).
- C-08 pairing is a service-coverage rule for non-frontend services; it does not apply to workflow files, so no coverage
  threshold is enforced. The paired tests are still mandatory (P-06, C-15).

---

### Step 1 — test: RED harness for the SUPERSEDED wait-loop branch (AC-1)

**Status**: `done`
**Service**: `.github/workflows` (CI/CD; no registry service owner), test lives in `scripts/`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (extend `group_deploy`)

**Reviewers**: Platform Lead — cross-workflow deploy topology (DO + homelab) and CI gate completeness

**Codebase Evidence**:
- Confirmed via: `grep -n "^group_deploy\|# AC-17/AC-21\|# callers: secrets inherit\|echo \"deploy: ok\"" scripts/sops-secrets.test.sh` → L619, L635, L664, L679.
- Existing pattern (L635-663): extracts a step's `run` with `yq e '.jobs.deploy.steps[] | select(.id == "resolve-app-id") | .run' "$wf"`, writes it to `$work/appid.sh`, builds a stub `doctl` under `$work/stub`, and runs `env -i PATH="$work/stub:$PATH" HOME="$HOME" ... bash -eo pipefail "$work/appid.sh" >"$work/aout" 2>&1 || rc=$?`, then asserts on `rc` and output. Reuse `$work`, `$work/stub`, `fail`, and `need yq python3` (already at L620).
- The "Wait for deployment" step has **no `id:`** (`.github/workflows/deploy.yml:105`, `- name: Wait for deployment`), so select it by `.name == "Wait for deployment"`. Do not add an `id:` to the workflow.
- The step's script reads `$APP_ID` and calls `doctl apps list-deployments "$APP_ID" --format ID --no-header` (`deploy.yml:107`) and `doctl apps get-deployment "$APP_ID" "$DEPLOY_ID" --format Phase --no-header` (`deploy.yml:110`); it calls `sleep 15` (`deploy.yml:119`) and prints `Timeout: deployment did not complete within 15 minutes.` (`deploy.yml:121`).
- Feasibility prototype (run during this spec, python `yaml` extraction + stub `doctl`/`sleep`) against the current `deploy.yml`: `SUPERSEDED` → rc=1, 60 polls, timeout message (the defect); `ACTIVE` → rc=0, 1 poll; `ERROR` and `CANCELED` → rc=1, 1 poll; `BUILDING` → rc=1, 60 polls, timeout message.
- Host caveat: the sandbox `yq` is the Python `kislyuk` yq, not mikefarah v4, so `need` (`scripts/sops-secrets.test.sh:19`) fails here. The step must be proven on a host with mikefarah yq (macOS `brew install yq`; the GitHub `ubuntu-24.04` runner has it).

**TDD**: `red-green required`

**Covers**: `AC-1` — a superseded deployment ends the wait loop on that poll, before the 60-iteration timeout, without the timeout message.

**Instructions**:
In `group_deploy`, insert a block after the resolve-app-id loop and before the `# callers: secrets inherit + environment`
comment at L664. The block:
1. Extracts the step: `wait="$(yq e '.jobs.deploy.steps[] | select(.name == "Wait for deployment") | .run' "$wf")"`; assert non-empty and not `null`; write it to `$work/wait.sh`.
2. Writes a stub `doctl` to `$work/stub/doctl` (overwriting the resolve-app-id stub, which is no longer needed at that point). It prints `dep-1` for `apps list-deployments`, and for `apps get-deployment` appends a line to `$work/polls` and prints `$STUB_PHASE`. Dispatch on `$2` (`list-deployments` / `get-deployment`); `doctl apps ...` puts `apps` in `$1`.
3. Writes a stub `sleep` to `$work/stub/sleep` that appends to `$work/sleeps` and exits 0, so the 60-iteration case is instant and the test can assert that nothing slept.
4. For each phase in `SUPERSEDED ACTIVE ERROR CANCELED BUILDING`: clear `$work/polls` and `$work/sleeps`, run `env -i PATH="$work/stub:$PATH" HOME="$HOME" APP_ID=app-1 STUB_PHASE="$phase" bash -eo pipefail "$work/wait.sh" >"$work/wout" 2>&1 || rc=$?`, and assert (messages prefixed `AC-1:`):
   - `SUPERSEDED`: `rc` = 0; `polls` has exactly 1 line; `$work/sleeps` is empty (it exited on that poll); `wout` does not contain `Timeout:`; `wout` contains `::warning::` (D-1).
   - `ACTIVE`: `rc` = 0, 1 poll (regression guard).
   - `ERROR`, `CANCELED`: `rc` = 1, 1 poll, `wout` contains `Deployment failed with phase: $phase` (regression guard).
   - `BUILDING`: `rc` = 1, `polls` has exactly 60 lines, `wout` contains `Timeout: deployment did not complete within 15 minutes.` (the timeout path still works).
   Initialise `rc=0` before each run (the file's idiom at L650).
5. Keep it to this one table; add no other phases and no helper outside `group_deploy`. The new locals (`wait`, `phase`) go in the existing `local` declaration at L621.

Apply the repo's shell conventions already used in this file: `A && B || fail "..."`, `shellcheck`-clean (the file header at L4 already disables SC2015/SC2016), bash 3.2-compatible (no `mapfile`, no associative arrays), 2-space indent (`shfmt -i 2`).

**RED requirement**: on the unmodified `deploy.yml`, `bash scripts/sops-secrets.test.sh deploy` must fail with `ASSERT FAIL: AC-1: SUPERSEDED ...` (rc=1 and 60 polls today). Capture that output before Step 2.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh deploy   # RED here: ASSERT FAIL: AC-1 ... ; GREEN only after Step 2
```
Requires mikefarah yq, python3, jq (see host caveat).

---

### Step 2 — service: end the wait loop on SUPERSEDED (AC-1)

**Status**: `done`
**Service**: `.github/workflows/deploy.yml` (reusable deploy workflow)
**Files**:
- `.github/workflows/deploy.yml` — modify (the "Wait for deployment" step only)

**Reviewers**: Platform Lead — cross-workflow deploy topology (DO + homelab) and CI gate completeness

**Codebase Evidence**:
- Confirmed via: `grep -n "Wait for deployment\|PHASE\|exit" .github/workflows/deploy.yml` → step at L105; loop L109-120; success branch L112-114; failure branch `elif [ "$PHASE" = "ERROR" ] || [ "$PHASE" = "CANCELED" ]` L115-117; `sleep 15` L119; timeout L121-122.
- Existing pattern (L112-118):
  `if [ "$PHASE" = "ACTIVE" ]; then echo "Deployment succeeded."; exit 0` / `elif [ "$PHASE" = "ERROR" ] || [ "$PHASE" = "CANCELED" ]; then echo "Deployment failed with phase: $PHASE"; exit 1`.
- `SUPERSEDED` is not referenced anywhere in `.github/workflows/` or `scripts/` today (grep over `*.yml *.yaml *.sh *.py *.md`; hits are unrelated SDD prose). The literal phase string is confirmed by the run #1213 job log (`[60/60] Phase: SUPERSEDED`) quoted in the defect report.
- Workflow-command annotation precedent in this file: `echo "::error::..."` at `deploy.yml:53`.

**TDD**: `red-green required` (paired test: Step 1)

**Covers**: —

**Instructions**:
In the "Wait for deployment" step, add one `elif` between the `ACTIVE` branch (ends L114) and the `ERROR`/`CANCELED` branch
(L115):

```bash
            elif [ "$PHASE" = "SUPERSEDED" ]; then
              echo "::warning::Deployment $DEPLOY_ID was superseded by a newer deployment; that deployment's run reports its outcome."
              exit 0
```

Indentation: 12 spaces, matching the surrounding `if`/`elif` (L112, L115). Change nothing else in the step: leave the
`DEPLOY_ID` line (L107), the 60 x 15 s cadence, the `ERROR`/`CANCELED` branch and the timeout message untouched. Do not
touch `resolve-app-id`, `setup-sops`, `render` or any other step (product-spec § Fix Scope).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh deploy      # Step 1 assertions now GREEN
yq e 'true' .github/workflows/deploy.yml      # still parses
git diff --stat -- .github/workflows/deploy.yml   # only the 3 added lines
git diff -U0 -- .github/workflows/deploy.yml | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -c .   # expect 3
```
`actionlint` is not installed in this sandbox and has no CI job in `.github/workflows/ci.yml` (grep returned no hit); run it
locally if available (`actionlint .github/workflows/deploy.yml`, macOS `brew install actionlint`) and otherwise state in the
PR body that it was not run.

---

### Step 3 — test: RED assertion for the deploy concurrency group (AC-2)

**Status**: `pending`
**Service**: `.github/workflows` (CI/CD; no registry service owner), test lives in `scripts/`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (extend `group_deploy`)

**Reviewers**: Platform Lead — cross-workflow deploy topology (DO + homelab)

**Codebase Evidence**:
- Confirmed via: `grep -n "concurrency" .github/workflows/*.yml` → only `deploy-homelab.yml:54-56` (job-level, `group: deploy-homelab-${{ inputs.environment }}`, `cancel-in-progress: false`), `prod-down.yml:17` and `prod-up.yml:19` (`concurrency: prod-lifecycle`). `deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml` have none.
- No group-name collision: proposed `deploy-staging` / `deploy-production` vs `deploy-homelab-staging` / `deploy-homelab-production` vs `prod-lifecycle`.
- Existing static-assertion idiom in `group_deploy` (L632-634): `[ "$(yq e '.jobs.deploy.environment' "$wf")" = '${{ inputs.environment }}' ] || fail "deploy: job environment binding"` with `# shellcheck disable=SC2016` on the line above for the literal `${{`. Mirror it exactly.
- `group_deploy` currently pins `.jobs.deploy.environment`, `.jobs.validate | has("environment")` and `.jobs.deploy.needs` and does not mention `concurrency` (L632-634), so adding a job-level key cannot trip the existing assertions.

**TDD**: `red-green required`

**Covers**: `AC-2` — two pushes within a minute deploy the same app one at a time (configuration pinned; runtime behavior observed post-merge, see Step 4).

**Instructions**:
In `group_deploy`, insert after the `.jobs.deploy.needs` assertion (L634) and before the `# AC-17/AC-21` comment (L635),
assertions prefixed `AC-2:`:
- `[ "$(yq e '.jobs.deploy.concurrency.group' "$wf")" = 'deploy-${{ inputs.environment }}' ] || fail "AC-2: deploy job concurrency group"` (preceded by `# shellcheck disable=SC2016`, as at L631).
- `[ "$(yq e '.jobs.deploy.concurrency.cancel-in-progress' "$wf")" = false ] || fail "AC-2: cancel-in-progress must be false (never abort an in-flight deployment)"`.
- `[ "$(yq e '.jobs.validate | has("concurrency")' "$wf")" = false ] || fail "AC-2: validate must not carry the deploy group"`.
- `[ "$(yq e 'has("concurrency")' "$wf")" = false ] || fail "AC-2: no workflow-level concurrency in the reusable workflow"` (a workflow-level group in a called workflow is evaluated alongside the caller's and is the known way to cancel/deadlock a caller; the group must live on the job only).
- For `.github/workflows/deploy-dev.yml` and `deploy-prod.yml`: `[ "$(yq e '.jobs.deploy | has("concurrency")' "$f")" = false ]` and `[ "$(yq e 'has("concurrency")' "$f")" = false ]` — place these inside the existing `for e in staging production` caller loop (L665-674) so the group is defined once, in `deploy.yml`, and both callers inherit it. Message: `"AC-2: $f must not define its own concurrency (the group lives in deploy.yml)"`.

Add nothing else (no runtime simulation of GitHub's queue).

**RED requirement**: on the tree after Step 2, `bash scripts/sops-secrets.test.sh deploy` must fail at `ASSERT FAIL: AC-2: deploy job concurrency group`. Capture it before Step 4.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh deploy   # RED here: ASSERT FAIL: AC-2 ...; GREEN only after Step 4
```

---

### Step 4 — service: serialise deploys to one DO app with a job-level concurrency group (AC-2)

**Status**: `pending`
**Service**: `.github/workflows/deploy.yml` (reusable deploy workflow)
**Files**:
- `.github/workflows/deploy.yml` — modify (the `deploy` job header only)

**Reviewers**: Platform Lead — cross-workflow deploy topology (DO + homelab)

**Codebase Evidence**:
- Confirmed via: `sed -n 31,40p .github/workflows/deploy.yml` → `deploy:` L31, `needs: validate` L32, `runs-on: ubuntu-latest` L33, `environment: ${{ inputs.environment }}` L34, `permissions:` L35-36, `env:` L37-39.
- Existing pattern to mirror, `.github/workflows/deploy-homelab.yml:54-56`:
  `concurrency:` / `group: deploy-homelab-${{ inputs.environment }}` / `cancel-in-progress: false` (job-level, directly after `environment:` at L53).
- `deploy.yml` is the only path to `doctl apps update` for the DO app from the dev/prod pushes: `deploy-dev.yml:46` and `deploy-prod.yml:45` both `uses: ./.github/workflows/deploy.yml`. `inputs.environment` is validated to `staging|production` by the `validate` job (`deploy.yml:25-29`), so the group is one of exactly two values.
- `inputs` is an available context for `jobs.<job_id>.concurrency`; `deploy.yml:34` already uses `inputs.environment` at job level.

**TDD**: `red-green required` (paired test: Step 3)

**Covers**: —

**Instructions**:
In the `deploy` job of `.github/workflows/deploy.yml`, insert immediately after `environment: ${{ inputs.environment }}`
(L34) and before `permissions:` (L35):

```yaml
    concurrency:
      group: deploy-${{ inputs.environment }}
      cancel-in-progress: false
```

Do not add `concurrency` to `validate`, to the workflow root, or to `deploy-dev.yml`/`deploy-prod.yml` (Step 3 pins this).
Effect: for one environment at most one `deploy` job runs and at most one is pending; a newer push's `deploy` job replaces
an older pending one (the older run ends *cancelled*, not failed) and waits for the running one to finish rather than
creating a deployment that supersedes it. `.do/app*.yaml`, `docker-compose.yml`, env vars and ports are untouched.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh deploy      # Steps 1 and 3 GREEN
yq e 'true' .github/workflows/deploy.yml
git diff -U0 -- .github/workflows/deploy.yml | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -c .   # expect 6 across Steps 2+4 (3 + 3)
bash scripts/sops-secrets.test.sh            # all groups still pass (the deploy.yml LEGACY_/P: rules, resolve-app-id stub test, caller gates)
```
`actionlint .github/workflows/deploy.yml` if available (see Step 2 note).
Post-merge, not part of this step's gate (operator observes AC-2's runtime behavior): push two commits to `main-dev`
within about a minute and confirm in the Actions tab that the second "Deploy dev" run's "Deploy to dev" job shows
*Waiting for a concurrent run* until the first finishes, that no run ends red, and that a third push inside the window
shows the middle run as cancelled.

---

### Step 5 — docs: state the new wait/serialisation behavior in the CI overview

**Status**: `pending`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/ci-overview.md` — modify (one sentence at L57)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "waits up to 15 minutes" docs/patterns/ci-overview.md` → L57: `DO deployment waits up to 15 minutes for the App Platform phase to reach \`ACTIVE\`.` (the only doc describing the wait; `grep -rn "Wait for deployment" docs` hits only the defect report).
- `docs/patterns/ci-overview.md` is not in `.agents/context-forge.json` `scrubberExtraTargets` (`README.md`, `docs/patterns/ui-ux-governance.md`), is not a `CLAUDE.md`, constitution or findings doc, and no `PLAT-*`/context-constitution entry mentions the wait loop or `deploy.yml`, so the root CLAUDE.md Teardown `/context-forge:context-constitution refresh` is not triggered by this step. Re-check at execute time if any other context file ends up modified.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Replace the sentence at L57 with:
"DO deployment waits up to 15 minutes for the App Platform phase to reach `ACTIVE`; a `SUPERSEDED` phase (a newer
deployment of the same app took over) ends the wait as success with a `::warning::`. Deploys to one app serialise on the
`deploy-<environment>` concurrency group in `deploy.yml`, and a deploy overtaken by a newer push while still queued ends
cancelled, not failed."
Change nothing else in the file.

**Verification**:
```bash
grep -n "SUPERSEDED\|deploy-<environment>" docs/patterns/ci-overview.md   # both present on L57
git diff --stat -- docs/patterns/ci-overview.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
