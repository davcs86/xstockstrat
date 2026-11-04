# Context Log: fix-deploy-wait-loop

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via `--from-report`: `docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md` (Issues disabled)
- Severity: SEV-3; env dev; not config-only → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected: `.github/workflows/deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml`
- Root cause: confirmed from job 126410876732 log — phase literal is `SUPERSEDED` (not guessed); no concurrency group
- Recommended design depth: skip → `/sdd-spec fix-deploy-wait-loop` (rationale: SEV-3, CI-only, no proto/migration/config, root cause known)
- Development branch: feature/fix-deploy-wait-loop
- Findings carried to spec: `deploy.yml` is called by both dev and prod, so a job-level `concurrency` on its `deploy` job keyed on `inputs.environment` covers both (group `deploy-staging` / `deploy-production`; `deploy-homelab.yml:54` uses `deploy-homelab-<env>`, `prod-up/down` use `prod-lifecycle` — no collision). GitHub keeps one pending run per group and cancels older pending ones (cancelled, not failed).
- Open decision for spec: SUPERSEDED as success-with-warning vs distinct failure. Leaning success+`::warning::` (our commit is carried by the newer deployment; concurrency removes the CI-internal source).
- `scripts/sops-secrets.test.sh` `group_deploy` pins `.jobs.deploy.environment`, `.needs`, `resolve-app-id`; it does not pin `concurrency`, so adding it should not trip the static checks — verify by running it. `actionlint` is not installed in this sandbox.
- Local checkout of main-dev was behind origin (lacked feature 286); fast-forwarded before reading `deploy.yml`.

## Session 2026-11-04 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status draft → implementation-ready. Design phase was skipped per the triage `skip` recommendation (no recon.md/design.md); the product spec had not been AI-reviewed, and the guard's "proceed anyway" was taken from the triage Next Action (`/sdd-spec` directly), not an interactive yes. Confirm at `/sdd-review impl-spec`.
- Key codebase findings:
  - "Wait for deployment" is `deploy.yml:105-122`, no `id:`; the SUPERSEDED branch goes between the ACTIVE (L112-114) and ERROR/CANCELED (L115-117) branches. The `deploy` job header takes `concurrency` after `environment:` (L34), mirroring `deploy-homelab.yml:54-56`. Callers `deploy-dev.yml:43-51` / `deploy-prod.yml:42-50` need no change.
  - `group_deploy` (`scripts/sops-secrets.test.sh:619-680`) already runs a stub-`doctl` harness for `resolve-app-id`; the wait step can be tested the same way with stub `doctl` + `sleep`. A prototype against the unmodified file reproduced the defect (SUPERSEDED rc=1, 60 polls, timeout message) and showed ACTIVE/ERROR/CANCELED unchanged.
  - Sandbox `yq` is the Python kislyuk yq, so `need` in the test script fails here; run the test on a host with mikefarah yq (CI `sops-secrets` job on ubuntu-24.04 does). `actionlint` is not installed here and has no CI job.
  - Decision D-1 (SUPERSEDED exits 0 with `::warning::`) and D-2 (`cancel-in-progress: false`) are recorded in the spec; D-1 needs reviewer confirmation.
  - `prod-up.yml:93-109` has an identical wait loop with no SUPERSEDED branch; out of scope per product-spec, serialised by `prod-lifecycle`. Surfaced as an open follow-up.
  - Feature 258 context.md:794 records the same false-red once before (run for `1f341870` SUPERSEDED) and accepted it; this is a recurrence.
  - `docs/patterns/ci-overview.md:57` is the only doc describing the wait; it is not a context-forge teardown target.

## Session 2026-11-04 — sdd-execute (sequential)

- Operator decisions (AskUserQuestion, this session): D-1 confirmed — SUPERSEDED exits 0 with `::warning::`; branch `feature/fix-deploy-wait-loop` with an integration PR into `main-dev`; run `/sdd-spec` then `/sdd-execute` rather than implementing directly. Product spec was never AI-reviewed (`/sdd-review` not run); operator chose to proceed.
- Re-spec gate: branch is 0 behind `origin/main-dev`; every step's Codebase Evidence grep matched the live tree. No re-spec.
- Tooling setup (steps 1-5): mikefarah yq v4.44.3 ⬇ (go install, scratchpad bin) · actionlint v1.7.7 ⬇ (same) · jq ✓ · python3 ✓ · shellcheck ✗ · shfmt ✗ (not required by any step's Verification; actionlint runs without shellcheck integration, test-file shell style checked by eye) · no DB, none needed.

### Step 1 — test: RED harness for the SUPERSEDED wait-loop branch (AC-1) [done]
- Extended `group_deploy` with a stub `doctl`/`sleep` harness that runs the real "Wait for deployment" script for SUPERSEDED, ACTIVE, ERROR, CANCELED and BUILDING.
- TDD AC-1 red: `bash scripts/sops-secrets.test.sh deploy` → `ASSERT FAIL: AC-1: SUPERSEDED exited 1 after 60 polls (Timeout: deployment did not complete within 15 minutes.)` (exit 1) — the reported defect, against unmodified `deploy.yml`. Green follows Step 2.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 2 — service: end the wait loop on SUPERSEDED (AC-1) [done]
- Added `elif [ "$PHASE" = "SUPERSEDED" ]` (`::warning::` + `exit 0`) between the ACTIVE and ERROR/CANCELED branches of "Wait for deployment" in `deploy.yml`; nothing else in the step or file touched (diff = 3 added lines; SOPS steps untouched).
- TDD AC-1 green: `bash scripts/sops-secrets.test.sh deploy` → `deploy: ok` / `all assertions passed (deploy)` (exit 0; was red in Step 1). `yq e 'true'` parses; `actionlint .github/workflows/deploy.yml` exit 0 (without shellcheck).
- Files modified: `.github/workflows/deploy.yml`
- Deviations: none

### Step 3 — test: RED assertion for the deploy concurrency group (AC-2) [done]
- Pinned in `group_deploy`: `jobs.deploy.concurrency.group == deploy-${{ inputs.environment }}`, `cancel-in-progress == false`, no `concurrency` on `validate` or at workflow root of `deploy.yml`, and none on `jobs.deploy` / root of `deploy-dev.yml` and `deploy-prod.yml` (inside the existing caller loop). Config pin only; GitHub's queueing is observed post-merge.
- TDD AC-2 red: `bash scripts/sops-secrets.test.sh deploy` → `ASSERT FAIL: AC-2: deploy job concurrency group` (exit 1) on the tree after Step 2; the Step 1 AC-1 assertions run first and pass. Green follows Step 4.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 4 — service: serialise deploys to one DO app with a job-level concurrency group (AC-2) [done]
- Added `concurrency: {group: deploy-${{ inputs.environment }}, cancel-in-progress: false}` to the `deploy` job header of `deploy.yml` (after `environment:`). Callers `deploy-dev.yml` / `deploy-prod.yml` unchanged; they inherit it through `uses:`. Total `deploy.yml` diff vs `main-dev` after Steps 2+4: 6 added lines.
- TDD AC-2 green: `bash scripts/sops-secrets.test.sh deploy` → `deploy: ok` (exit 0; was `ASSERT FAIL: AC-2: deploy job concurrency group` in Step 3). Full script, all groups (action resolve build render deploy produp homelab bootstrap ac24 cleanup) → `all assertions passed` (exit 0) with mikefarah yq v4.44.3 and sops v3.13.3 built locally. `actionlint` on `deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml` → exit 0 (no shellcheck integration).
- Not verifiable here (post-merge, operator): push two commits to `main-dev` within ~1 min and confirm the second run's "Deploy to dev" shows *Waiting for a concurrent run*, no run ends red, and a third push in the window cancels the middle run's pending deploy job.
- Files modified: `.github/workflows/deploy.yml`
- Deviations: none

### Step 5 — docs: state the new wait/serialisation behavior in the CI overview [done]
- Replaced the single sentence at `docs/patterns/ci-overview.md:57` with the SUPERSEDED-as-success and `deploy-<environment>` serialisation behavior. TDD: N/A (docs).
- Verification: `grep -n "SUPERSEDED\|deploy-<environment>" docs/patterns/ci-overview.md` → both present (L57, L59).
- Teardown (root CLAUDE.md): not triggered — no `CLAUDE.md`, constitution or findings doc changed; `ci-overview.md` is not in `.agents/context-forge.json` `scrubberExtraTargets` (`README.md`, `docs/patterns/ui-ux-governance.md`); no context file describes the wait loop (grepped `CLAUDE.md`, `docs/context-constitution*.md`, `docs/runbooks/*.md`, `README.md`).
- Files modified: `docs/patterns/ci-overview.md`
- Deviations: none

## Session 2026-11-04 — sdd-execute (sequential)
**Steps this session**: 1, 2, 3, 4, 5
**Progress**: 5 done / 5 total
**Stopped at**: all complete (feature-end checkpoint; integration PR next)
- `node scripts/check-config-wiring.mjs --final` → exit 0; one pre-existing unrelated `REPORTED: ...trading.fill_poller.interval_ms:read-unseeded:production` line, no finding for this feature (no config keys declared).
- Open follow-up (not fixed, out of scope per product-spec): `prod-up.yml:93-109` has the same wait loop without a SUPERSEDED branch (serialised by `concurrency: prod-lifecycle`).
- Open follow-up: `DEPLOY_ID` is taken from `list-deployments | head -1`, which can pick another run's deployment; not made race-free here.
**Next**: integration PR to `main-dev`
- C-16 promotion (operator-approved): `@AC-1` and `@AC-2` appended to `docs/sdd/business-rules/platform.feature` tagged `@feature-288` (CI-workflow guarantees, no owning service). No merge-order entry for 288.
