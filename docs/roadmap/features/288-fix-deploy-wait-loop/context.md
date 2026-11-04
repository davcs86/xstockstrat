# Context: 288-fix-deploy-wait-loop  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: SEV-3 Track C bug (Type bug, `--from-report` of `docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md)). Run #1213 of "Deploy dev" went red after a 16-minute poll because its DO deployment reached the terminal phase `SUPERSEDED` (newer push, run #1214, deployed ~45 s later) and the "Wait for deployment" loop in the reusable `.github/workflows/deploy.yml` only ended on `ACTIVE`/`ERROR`/`CANCELED`; the app was healthy. Shipped in 5 steps on `feature/fix-deploy-wait-loop` (promoted via PR #1422, `0ef77aa1`): a `SUPERSEDED` branch that `::warning::`s and `exit 0`s (`deploy.yml:126`), a job-level `concurrency` group `deploy-${{ inputs.environment }}` with `cancel-in-progress: false` on the `deploy` job (`deploy.yml:35`), RED/GREEN assertions in `group_deploy` of `scripts/sops-secrets.test.sh` (AC-1 stub-run L709-, AC-2 config pins L666-671), and one doc sentence at `docs/patterns/ci-overview.md:57`. No proto, migration, config key or service change; the feature-286 SOPS steps were untouched. Both `@AC-*` are already promoted to `docs/sdd/business-rules/platform.feature` (`@feature-288`, L1027/L1033).

**Why (irrecoverable rationale)**:
- Two compounding causes, both fixed: the missing terminal branch (the literal `doctl` phase string `SUPERSEDED` was confirmed from job 126410876732's log, iterations 24-60, not guessed) and no `concurrency` group serialising runs against one DO app. The concurrency group removes the CI-internal source of supersession; the branch handles the rest.
- D-1: SUPERSEDED is success-with-warning, not a distinct failure, because the reported defect is a falsely red run for a healthy app, a newer deployment of the same app took over, and that deployment's own run reports the outcome. Operator confirmed D-1 at the execute session (the spec had not been AI-reviewed; `/sdd-review` was never run and the operator chose to proceed).
- One group in `deploy.yml` covers both callers because `deploy-dev.yml:43-51` and `deploy-prod.yml:42-50` both `uses:` it; the group resolves to exactly two values (`deploy-staging` / `deploy-production`) since `validate` restricts `inputs.environment`. No collision with `deploy-homelab-<env>` (`deploy-homelab.yml:54-56`) or `prod-lifecycle` (`prod-up/down`).
- GitHub semantics relied on: a group keeps one running and one pending job, and a newer push's pending job replaces the older pending one, which ends cancelled (grey), not failed.

**Rejected alternatives**:
- SUPERSEDED exits 1 with a distinct message — lost because it keeps the false-red the bug reports. Residual accepted risk: a deployment superseded by one created outside CI (console, manual `doctl`) now reports green.
- `cancel-in-progress: true` — lost because it would abort a deployment already in flight; `false` mirrors `deploy-homelab.yml:54-56`.
- Workflow-level `concurrency` in the reusable workflow — lost; a workflow-level group in a called workflow is evaluated alongside the caller's and is the known route to cancel or deadlock a caller, so the group lives on the `deploy` job only.
- A group on each caller (`deploy-dev.yml`/`deploy-prod.yml`) — lost because the group should be defined once, in `deploy.yml`, with both callers inheriting it. The test pins that `validate`, the `deploy.yml` root and both callers carry no `concurrency` (`sops-secrets.test.sh:666-671` plus the caller loop at L754).
- Adding an `id:` to the wait step to select it in tests — lost; the step is selected by `.name == "Wait for deployment"` instead (the spec states the rule, "do not add an `id:`", without a reason).

**Scars & gotchas**:
- The sandbox `yq` is the Python kislyuk yq, so `need yq` in `scripts/sops-secrets.test.sh` fails there; the script needs mikefarah yq v4 (CI `sops-secrets` job on ubuntu-24.04 has it; macOS `brew install yq`). The execute session installed mikefarah v4.44.3 and actionlint v1.7.7 via `go install` into the scratchpad, and ran the full suite (all groups) only after building sops v3.13.3 locally.
- `actionlint` has no CI job in `.github/workflows/ci.yml`; it was run locally (exit 0, without shellcheck) and is not gated; shellcheck and shfmt were absent, so the test file's shell style was checked by eye.
- AC-2's runtime behavior (second run shows "Waiting for a concurrent run", no red run, a third push cancels the middle run's pending deploy) cannot be tested hermetically; only the config is pinned. The post-merge two-quick-pushes observation was handed to the operator and no result is recorded in context.md.
- The local main-dev checkout was behind origin (lacked feature 286) during triage; it was fast-forwarded before reading `deploy.yml`.
- `scripts/sops-secrets.test.sh` `group_deploy` previously pinned only `.jobs.deploy.environment`, `.needs` and `resolve-app-id`, so adding job-level `concurrency` could not trip existing assertions (verified by running all groups).
- Step 1's harness overwrites the earlier `resolve-app-id` stub `doctl` and adds a stub `sleep` that records calls, so the 60-iteration BUILDING case runs instantly and SUPERSEDED can assert zero sleeps.

- Rule interpretation (spec lines 66-67): C-08 coverage pairing is a service-coverage rule and does not apply to workflow files, so no coverage threshold applies to a CI-only fix, but paired tests stay mandatory under P-06/C-15.
- The spec session proceeded without `/sdd-review` on the triage Next Action's recommendation, not an interactive yes; the operator's explicit D-1 confirmation came at the execute session.
- `check-config-wiring.mjs --final` reported a pre-existing, unrelated `trading.fill_poller.interval_ms:read-unseeded:production` line during execute (no finding for this feature); recorded here because the old context.md was its only record.

**Permanent deviations**: none. Design depth was `skip` (no `recon.md`/`design.md` exist); the spec's D-1/D-2 were the only decisions and shipped as written.

**Cross-feature signal**:
- Recurrence of feature 258: `docs/roadmap/features/258-fix-config-stream-resilience/context.md:39` records the same false-red (deploy run for `1f341870` marked "failed" because DO SUPERSEDED it by `9bd923f3`) and accepted it as noise; 288 is the same defect hitting again (spec session, old context.md@d5cdb712:30).
- Interacts with feature 286 (SOPS handling in `deploy.yml`): 288 edits the same file but deliberately leaves `resolve-app-id`, `setup-sops` and the render steps alone (product-spec Fix Scope).

**Deferred follow-ons**:
- `prod-up.yml` had the same wait loop without a SUPERSEDED branch at spec time (out of scope for 288). Already handled afterwards, differently: at HEAD (d5cdb712) its loop (`prod-up.yml:124-169`) has a `SUPERSEDED)` case that clears the pin and keeps polling (L163-165), redeploys once on ERROR, and warns instead of failing on timeout (L169); `concurrency: prod-lifecycle` is at L21. Not a live gap — do not rediscover it from the stale pointer in the pruned spec or old context.md.
- `DEPLOY_ID` is taken from `doctl apps list-deployments | head -1` (`deploy.yml:118` at d5cdb712), which can pick another run's deployment; not made race-free (product-spec Out of Scope). The new concurrency group narrows but does not remove the window.
- Post-merge operator observation of AC-2 (see Scars) is unrecorded.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-11-04 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: none (CI-only; no context file describes the wait loop, per the execute session's grep of `CLAUDE.md`, `docs/context-constitution*.md`, `docs/runbooks/*.md`, `README.md`). `ci-overview.md` is not a context-forge scrubber target.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at d5cdb712. (No recon.md or design.md ever existed for this feature.)
