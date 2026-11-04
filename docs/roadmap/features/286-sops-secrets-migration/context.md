# Context: sops-secrets-migration

**Feature**: `docs/roadmap/features/286-sops-secrets-migration/feature.md`
**Product Spec**: `docs/roadmap/features/286-sops-secrets-migration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/286-sops-secrets-migration/implementation-spec.md`

---

## Session 2026-11-03 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (gathered by interview before the story; binding on design):
  - Scope: DO runtime secrets (DEV_*/PROD_*) + homelab secrets (TS_AUTHKEY[_EXPIRES], DEPLOY_SSH_KEY,
    DEPLOY_KNOWN_HOSTS, APP_ENV, MTLS_CA). Platform creds stay native.
  - Keys: age, one keypair per env in the existing `staging`/`production` GitHub Environments as
    `SOPS_AGE_KEY`, plus operator recipient `vars.SOPS_OPERATOR_AGE_RECIPIENT`. The operator
    generates the keys locally, and the bootstrap derives the public keys via `age-keygen -y`.
  - Files: `secrets/{staging,production}.enc.yaml`, namespaced `digitalocean:`/`homelab:`
    (separate mTLS CAs — `docs/patterns/inter-service-mtls.md:105`).
  - DO deploy jobs bind to the existing staging/production environments, and the operator accepted
    their protection rules.
  - Cutover: dual-read with per-key fallback to legacy GitHub secrets and a source report, fail-closed
    only when a key is in neither. Legacy removal is a follow-up.
  - Homelab: SOPS **replaces** 1Password. The bootstrap reads the currently effective source.
  - APP_ENV: exploded per-key map `homelab.app_env`.
  - Bootstrap: PR to main-dev via GH_PAT, self-verifying.
  - SDD: operator chose to run the full SDD entry point (story → design quick) rather than treat this as process-only.
- Feature number 286 reserved via scripts/sdd-allocate-feature-number.sh (local max+1 would have given 285, which another session already holds on the cursor).
- Operator answers (2026-11-03, pre-review): work on `feature/sops-secrets-migration` + single squash PR
  into main-dev (overrides the harness "push only to main-dev" directive); bootstrap refuses to overwrite
  an existing file unless `force: true` (FR-5f, @AC-15); prod-up aligned to the full key set incl. VAPID +
  mTLS (FR-9, @AC-16 — a deliberate behavior change); `production` environment has no protection rules
  that would block binding the DO deploy jobs to it.

## Session 2026-11-03 — sdd-review product-spec

- First pass FAILED on criterion 9 (C-11): three unchecked Open Questions. Fixed by moving the Ledger
  traps (fails.md L1095, L443) into `## Notes for Design / Spec` and resolving the sops pin approach.
  Also applied the advisory fixes: AC-10/AC-12 Thens reworded as outcomes, @FR-9 added to AC-11, FR order corrected.
- Re-review: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings carried to design/spec:
  - [ ] Pin the exact sops/age version + SHA-256 at spec time.
  - [ ] Enumerate required vs optional keys per namespace (fail-closed must be testable per key).
  - [ ] Tighten AC-12's "VM reports healthy" into a concrete signal (e.g. `gate status` exit 0).
- Overlap findings: none in flight. Trunk context: rebase onto launched 279's `deploy-homelab.yml`,
  the `HOMELAB_DEPLOY_ENABLED` gate in deploy-dev/prod, and the `homelab-release-env.sh` contract.
- Recommended design depth: full (rubric default; two deploy targets, five workflows, secret custody).

## Session 2026-11-03 — operator revision (post spec-ready)

- Operator: three namespaces — `common` (app needs it regardless of hosting), `digitalocean` (DO-only),
  `homelab` (homelab-only). Supersedes the two-namespace layout.
- Operator: on a common-key conflict between DO and homelab sources, **DigitalOcean wins** (only the
  key names are logged). Homelab is **not live yet**, so this is non-disruptive.
- Operator: **unify MTLS_CA** into `common` from DO's CA (FR-10). This reverses
  `docs/patterns/inter-service-mtls.md:105` ("a separate CA from DO's"), and that doc must be updated.
- Operator: `digitalocean` holds APP_ID (R) + PROJECT_ID (O), moved from `DO_{DEV,PROD}_{APP,PROJECT}_ID`.
  DIGITALOCEAN_ACCESS_TOKEN stays native (account-wide; environment-less `prod-down.yml` uses it).
- Derived: every homelab key is optional at bootstrap (not live) and required at homelab deploy.
  The required/optional matrix is in FR-3, which closes the review warning "enumerate required vs optional".
- New hazard recorded: a stale `digitalocean.APP_ID` after prod-up recreation fails safe. prod-up's
  warning now points at the SOPS file (@AC-17).
- New scenarios: @AC-17..@AC-20. AC-2 rewritten for the 3-namespace split (same ID, pre-design).
- Spec materially changed after the review gate, so re-review was run (see next entry).
- Re-review of the revised spec: PASS WITH WARNINGS, no blockers; status stays spec-ready. Applied:
  FR-6 now reads `common` + `digitalocean` explicitly, and AC-2 asserts `digitalocean.PROJECT_ID`.
  Carried: AC-14 is inspection-only (accepted); sops/age pin at spec time; AC-12 health signal to tighten.
- Operator (2026-11-03): DO app ID is **resolved by spec name** at deploy time (FR-11, @AC-17/@AC-21)
  instead of being stored. This removes the stale-ID-after-prod-up hazard outright. The rejected
  alternative, prod-up running `sops set` and opening a PR, leaves main stale until merge + promotion.
  `digitalocean` now holds only PROJECT_ID. @AC-17 was rewritten pre-design (same ID).
- Operator: design depth = **full**.
- Phase 0 recon written (recon.md). Corrected the spec's gate-var name to HOMELAB_STAGING_ENABLED/HOMELAB_PRODUCTION_ENABLED (recon finding).

## Session 2026-11-03 — sdd-design (full) Phase 1, round 1

- Proposal: Python resolver `scripts/sops_secrets.py` (resolve/build, one KEYS table), unified
  `scripts/do-render-app-spec.py` (replaces do-inject-prod-secrets.py), composite `.github/actions/setup-sops`,
  env-bound deploy.yml, app-ID by name, bootstrap matrix → ciphertext artifacts → single PR job.
- Adversary verdict: NEEDS WORK — 1 blocker, 6 major, no Floor breach.
  - O1 BLOCKER (C-16 @feature-210 @AC-2/@AC-4): in an `environment:`-bound reusable job, the env secret
    `MTLS_CA` (homelab CA) shadows the caller-passed `MTLS_CA` (DEV_/PROD_MTLS_CA), which silently swaps DO's CA
    at rollout step 1. Fix: read legacy values only under DEV_/PROD_ names via `secrets: inherit`.
  - O2: homelab detaches to the image commit (deploy-homelab.yml:64-81), so tooling and SOPS must resolve before detach / from GITHUB_SHA.
  - O3: force guard fails open (depth-1 checkout has no origin/main-dev). Rollout needs promotion to main
    before the bootstrap can be dispatched (default branch = main). deploy-homelab.yml:19 says production "needs the
    environment's reviewers", which contradicts the "no protection rules" answer, so re-confirm with the operator.
  - O4: APP_ENV render not byte-safe (compose-go `$`/` #` expansion), so single-quote the common keys. Parser must
    mirror the `owned` regex (export/KEY:) and render common LAST so DO wins.
  - O5: `build` must mask exploded/1P values. Render script masks yaml_pem leaf/CA strings. Errors name keys only.
  - O6: warn when the SOPS value differs from the legacy value (names only). A force reseed lists changed keys by hash in the PR body.
  - O7: avoid exporting secrets to GITHUB_ENV in DO (resolve+render in one process). SHA-pin actions where it is kept.
  - Minors: platform @AC-8 names the deleted script (EXTEND); derive placeholders from KEYS; refuse non-string
    leaves; 1Password-in-bootstrap is YAGNI for a non-live homelab (operator call); verify the sops ≥3.9 CLI at spec time.
- Gate after round 1 (operator, 2026-11-03):
  - Shared CA confirmed (FR-10). Shadowing is made **structurally impossible**: callers use `secrets: inherit`,
    and deploy.yml reads fallbacks only under DEV_/PROD_ names (@AC-22).
  - `production` **has required reviewers**, which corrects the earlier answer. The operator accepts the approval gate on
    every DO prod deploy and prod-up.
  - **Drop 1Password from the bootstrap.** The bootstrap seeds common + digitalocean only, and homelab is filled by hand via
    `sops set` later. FR-5(a)/(a2) rewritten. @AC-3, @AC-4 and @AC-19 RETIRED (own pre-launch ACs; IDs kept).
    @AC-2 rewritten. @AC-23 added: app_env may not hold a common key, which enforces DO-wins.

## Session 2026-11-03 — sdd-design (full) Phase 1, round 2

- Revised proposal:
  - The resolver library is imported by `do-render-app-spec.py`, so DO resolves and renders in one process with no GITHUB_ENV export.
  - Homelab resolves before the image-commit detach.
  - `LEGACY_*` fallbacks are read via `secrets[format('{0}_K', P)]` under `secrets: inherit`.
  - Bootstrap guard does an explicit fetch of main-dev, with fetch-fail ≠ absent.
  - KEYS-derived placeholders, so a new secret needs one KEYS edit.
- Adversary: APPROVABLE WITH CONDITIONS, no Floor breach, O1–O10 resolved (O7 homelab partial, A2 partial).
  - C1 (major): homelab legacy fallbacks (own MTLS_CA env secret; JWT etc. via the APP_ENV blob) contradict
    FR-10/FR-5(a2), an intra-spec contradiction (fails.md:455). Fix 1a: homelab common-key fallbacks read DEV_/PROD_ too.
  - C2 (major): stdlib has no YAML emitter. Pipe JSON (`--input-type json --output-type yaml`) and assert str leaves.
  - C3 (major): "byte-identical spec" is false, because leaves are re-minted per deploy. Parity = identical after normalising
    leaf yaml_pem blocks. Permanent reverse-substitution identity test plus a one-time old-vs-new check.
  - Minors:
    - validate `inputs.environment` ∈ {staging, production} first
    - resolve the app ID before decrypting; name = `xstockstrat-<env>`, asserted against the spec
    - rm the rendered spec with `if: always()`
    - push with `--force-with-lease`
    - homelab per-name 0600 files instead of GITHUB_ENV (or waive)
    - skip masks shorter than 4 chars
    - no `python3 -I` / insert sys.path
    - ruff check + format in the new CI job
    - prod-up hard-fail is a deliberate behaviour change; include PROD_MTLS_CA
    - preflight checks that no env secret is named DEV_*/PROD_*
    - A2 sops/age CLI smoke test as the first, gating execute step
- Gate after round 2 (operator, 2026-11-03):
  - Homelab common-key fallbacks read DEV_/PROD_ (fix 1a). FR-7 text updated. The legacy APP_ENV blob is stripped
    of common keys, and DO values are appended last. The stale FR-5(d) APP_ENV round-trip text is struck.
  - Homelab GITHUB_ENV export: the operator noted TS_AUTHKEY/DEPLOY_SSH_KEY are infra creds like the DO token.
    Accepted (waived): first-party same-repo scripts, no third-party `uses:` after resolve, whereas the DO token already
    goes to a floating-tag third-party action. Re-confirmed at the round-3 gate.
  - Operator chose to run round 3 (fold the conditions, re-review) rather than approve with conditions.

## Session 2026-11-03 — sdd-design (full) Phase 1, round 3

- Final consolidation folded every round-2 condition in, plus:
  - a validate job (no environment) ahead of input-driven env-bound jobs
  - app-ID-first ordering, with an always-run cleanup step
  - homelab APP_ENV = body + DO common tail
  - bootstrap feeds JSON to sops encrypt, with cwd=$RUNNER_TEMP
  - fetch refspec, then force-with-lease
  - a permanent reverse-substitution test (AC-8)
  - an A2 smoke test as execute step 1
- Adversary: APPROVABLE WITH CONDITIONS; all round-2 conditions MET; no Floor breach; no C-16 regression.
  - Major: the AC-22 static test must also pin the right-hand side of every LEGACY_ line and the P expression.
    Otherwise a crossed fallback deploys wrong values and is then seeded into SOPS (C-16 trading @AC-4, config @AC-16, @AC-9).
  - Also: the AC-8 leaf key pubkey must equal the same-suffix cert's; sentinels must be fixed-width and delimited; values
    get no normalisation, asserted with trailing whitespace/newline; record the C-13 waiver for the inline fixture CA builder.
  - Rulings: agreed with the proposer on validate-job rationale, force-with-lease refspec, and the C-13 outcome.
- Round 4: platform.feature @AC-8 EXTEND moved to own @AC-24 (promoted at launch). Reason: docs/sdd/business-rules/CLAUDE.md:51 forbids hand-authoring rules there.

## Session 2026-11-03 — sdd-design (full) Phase 1, round 4

- Proposer wrote the complete design, folding in A1–A5, both preflight lists, and P in the homelab job env. Its flags
  were resolved by the orchestrator: @AC-24 instead of a platform.feature hand-edit; A1 tightened (each name exactly once,
  a single job-level P, the matrix pinned).
- Adversary: APPROVABLE WITH CONDITIONS. All amendments are MET, with no major/blocker issue, no Floor breach and no
  C-16 regression. Six wording edits were applied to the draft: AC-1 stderr text, AC-8 summary-label coverage, AC-12
  word-boundary regex, the AC-11/16 path (acceptance.feature updated to $RUNNER_TEMP/app.yaml), Rounds wording, and the
  type of the environment input plus the E env var.

## Session 2026-11-03 — sdd-design (completion)

- Phase 0 Recon: wrote recon.md (surfaces: DO deploy chain, homelab chain, CI harness, docs). Key reuse patterns: the pinned-binary
  install (deploy-homelab.yml:198-204) and the GH_PAT PR mechanics (sync-main-to-maindev.yml).
- Phase 1 Grilling: 4 rounds (full). Operator approved at the round-4 gate.
  - Chosen approach: one KEYS table in `scripts/sops_secrets.py`. DO resolves and renders in one process
    (`do-render-app-spec.py`). Homelab resolves before the image-commit detach. Fallbacks use `inherit` +
    `secrets[format('{0}_K', P)]`, with right-hand sides pinned by a static test. Composite setup-sops action. Bootstrap
    matrix → ciphertext artifacts → one PR. A permanent reverse-substitution parity test.
  - Rejected: explicit passthrough / LEGACY_DO_* (CA shadowing), toJSON(secrets), image-commit resolution, golden
    files, 1Password in the bootstrap, a stored APP_ID, per-name files for homelab (waived).
- Constitution rules touched: C-01, F-04, C-08, C-10, C-11, C-13 (waiver), C-14, C-15, C-16, C-18, P-03, F-02.
  Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-11-04T01:10:00Z — sdd-spec

- Generated implementation-spec.md with 20 steps. Status → implementation-ready.
- Key codebase findings:
  - **Pins:** sops v3.13.3 (SHA-256 `e5bec334…ef6b`, matches upstream checksums.txt), age v1.3.2 (`cbe24006…ac10`, computed
    from the asset), action-doctl v2.5.2 `3cb39531…`, upload-artifact v7.0.2 `cf430e03…`, download-artifact v7.0.0
    `37930b1c…`, checkout v7.0.1 `3d3c42e5…` (already at `deploy-homelab.yml:60`). Resolved via `git ls-remote` and
    shallow tag fetches; `gh api` is not enabled for those repos in this session.
  - **Placeholder coverage:** the 10 non-MTLS `YOUR_(DEV|PROD)_*` names in `.do/app*.yaml` are exactly the 10 non-MTLS
    `common` KEYS. Every placeholder sits alone on a `value:` line, which settles design Risk 1 for today's specs.
  - **AC-24 gap the design missed:** `.do/app.yaml:381` and `.do/app.dev.yaml:383` comments still name `MCP_AGENT_SECRET`
    (pre-existing drift against platform @AC-8 as well). Step 17 rewords them.
  - **Spec-time detail:** `.sops.yaml` generation lives in a `sops_secrets.py sops-config` subcommand so it can be unit-tested
    (design AC-7 row). `sops-secrets.test.sh` takes group names so each test/code pair can go red then green. The
    `sops` CI filter includes `.do/**` because AC-8 renders the real specs.
  - `scripts/do-inject-prod-secrets.py` has exactly one caller (`prod-up.yml:60`), so deleting it in Step 12 is safe.
- Step order: smoke gate (1) → setup-sops (2) → resolver/build/renderer test+code pairs (3–8) → per-workflow static-test +
  rewrite pairs (9–16) → script/spec comment cleanup (17) → CI wiring (18) → runbook (19) → docs sweep (20).

## Open Threads

- [ ] Execute step 1: gating sops/age/compose smoke test, plus `secrets[format()]` under inherit (design Risk 7).
- [ ] Execute (render step): one-time normalised old-vs-new parity comparison recorded here (Risk 2); the reverse-map line
      assumption fails closed (Risk 1).
- [ ] Execute (bootstrap step): gitleaks allowlist for the age armor if flagged (Risk 5).
- [ ] Rollout, homelab enablement: GITHUB_ENV trailing-newline behaviour (Risk 3); `sops set` homelab.app_env first (Risk 6).
- [ ] Runbook: a newline in a common value is refused for homelab (Risk 4); the production reviewer gate on every prod deploy (Risk 8).
- [x] Spec: pin the sops/age versions and SHA-256 values, plus the action SHAs; grep placeholder coverage; ci.yml filter list (done 2026-11-04, see implementation-spec.md § Execution Summary).
- Ledger: appended an insights.md entry (environment-secret shadowing in env-bound reusable workflows).

## Session 2026-11-04 — sdd-review impl-spec (advisory), iteration 1 → fixes

- Result: 0 failures, ~13 warnings (advisory), no Floor breach. Overlap: WARN only. 278 and 281 append to the
  `ci.yml` ci-gate lists, and 281 also to the `docs/runbooks/CLAUDE.md` index and the `ci-overview.md` table. Recorded as
  spec-time finding 6; no merge-order row needed.
- Addressed in the spec (pre-execution edit; F-09 applies only once execution starts):
  - [x] P-06: Step 1 now creates the test skeleton + `action` group, giving Step 2 a RED-first test. Step 15 adds the `ac24` +
        `cleanup` groups, giving Step 17 a RED-first test. Step 18 is CI wiring only.
  - [x] Step 9: the cross-branch `git show origin/main-dev` comparison is replaced by content assertions on the homelab gates.
  - [x] AC-17/AC-21 are now permanent: the `resolve-app-id` step is extracted with yq and run against a stub doctl (group `deploy`).
  - [x] Step 10 deps (Steps 2, 8) added. Workflow YAML is parse-checked with yq in every static group and workflow step.
  - [x] Step 13 AC-12 regex: case-sensitive `\bop\b|\bOP_` + case-insensitive `1password|load-secrets-action`.
  - [x] Steps 5/7/9/15 now state the no-coverage-threshold note.
  - [x] Step 7: the reverse map runs as an inline python heredoc (C-18).
  - [x] Step 16: `.gitleaks.toml` declared as a conditional file.
  - [x] Step 20 split into Step 20 (`docs/`) and Step 21 (remaining surfaces + teardown). Total is now 21 steps; a grep, not line numbers, is authoritative.

## Session 2026-11-04 — sdd-review impl-spec (advisory), iteration 2 → fixes

- Result: all 13 iteration-1 items RESOLVED; 2 ✗ + 6 ⚠ new (advisory), no Floor risk. Fixed:
  - [x] Step 12 Verification grep self-matched the test file. Now uses `--exclude=sops-secrets.test.sh`.
  - [x] Step 7 renderer was not hermetic after the bootstrap merges. The group now runs a copy under `$work/repo/scripts/` (like Step 5).
  - [x] Step 12 `[absent]` markers are now the explicit `if: steps.check.outputs.app_id == ''` guard.
  - [x] Threshold note added to Steps 1, 11 and 13. The Step 18 filter now includes `secrets/**`. Step 21 teardown scope is Steps 19–21.
  - [x] Spec-time findings renumbered 1–6.

## Session 2026-11-04 — sdd-review impl-spec (advisory), iteration 3 → fixes

- Result: iteration-2 items all RESOLVED; 2 ✗ + 2 ⚠ new. Fixed:
  - [x] The `render` group's MCP_AGENT_SECRET assert would stay RED until Step 17, because the renderer keeps `.do/` comments. It is removed from
        `render`, since `ac24` already covers `.do/app*.yaml`.
  - [x] Step 8 parity verification was vacuous. The step now writes a distinct `- PARITY RECORD (286 step 8):` line and greps for it.
  - [x] `ac24`'s read of `secrets/*.enc.yaml` is kept, with an explicit carve-out (a read-only grep of ciphertext key names, never decrypting).
  - [x] The test skeleton does `cd "$(git rev-parse --show-toplevel)"`.

## Session 2026-11-04 — sdd-review impl-spec (advisory), iteration 4 → fixes

- Result: 0 failures, 3 minor ⚠; iteration-3 items 4/4 RESOLVED; the cross-step RED/GREEN walk is sound for every group. Fixed:
  - [x] W1: the Step 8 parity line wording now matches its `^- PARITY RECORD` grep.
  - [x] W2: the `cleanup` mtls-provision header assertion is now two concrete greps over lines 1–20.
  - [x] W3: the Step 2 real install is host-mutating. It is proven by the Step 18 CI job on an ephemeral runner, or optionally
        run in an ephemeral execute sandbox, never on a developer host.

## Session 2026-11-04 — sdd-review impl-spec (advisory), iteration 5 → fix

- Result: 0 failures, 1 ⚠; iteration-4 items 3/3 RESOLVED; no design or coverage gap.
  - [x] The Step 18 `git check-ignore -q` with several paths passes if any one is ignored (confirmed locally). The check is now
        per path, and also asserts `.sops.yaml` is not ignored.
  - Correction (orchestrator, local check): multi-path `git check-ignore -q` actually exits 128 ("--quiet is only valid with a
    single pathname"). The old command was broken, not vacuous. The per-path fix is correct either way.

## Session 2026-11-04 — sdd-review impl-spec (advisory), iteration 6 — CONVERGED

- Result: **CONVERGED: 0 failures, 0 warnings.** The iteration-5 item is RESOLVED. The fresh 21-step pass is clean: RED/GREEN sequencing per group,
  hermeticity, non-vacuous verifications, @AC coverage (AC-3/4/19 retired), and design/context consistency.
- Loop summary: 6 iterations (13 → 8 → 4 → 3 → 1 → 0 findings). No unaddressed items carried into execution.
- Status unchanged: implementation-ready (Mode B is advisory). Next: `/sdd-execute sops-secrets-migration`.

## Session 2026-11-04 — sdd-execute (sequential)

- Mode entry + plan confirmed by operator (sequential, no re-spec; merged origin/main-dev — unrelated 284 commit).
- Tooling setup (steps 1–21): sops ⬇ 3.13.3 (sha ✓) · age/age-keygen ⬇ v1.3.2 (sha ✓; system 1.1.1 shadowed) · yq ⬇ mikefarah v4.53.6 (sha ✓; system yq 0.0.0 was a different implementation) · shellcheck ⬇ 0.9.0 · shfmt ⬇ 3.8.0 · ruff ✓ 0.16.9 · docker compose ✓ v5.6.1 · jq ✓ · python3 ✓ 3.13 · openssl ✓ · gitleaks ✗ (optional per Step 16 "when available locally"; CI's secret-scan job runs it)

### Step 1 — Gating smoke test of the pinned sops/age/compose behaviour [done]
- Pinned sops 3.13.3 / age v1.3.2 (sha-verified) run in the scratchpad, never the repo. Results:
  1. PASS. `printf json | sops encrypt --input-type json --output-type yaml --filename-override secrets/staging.enc.yaml --age p1,p2 /dev/stdin` works with no .sops.yaml present; 2 recipients; leaves `ENC[AES256_GCM,`.
  2. PASS. cwd in a scratch dir with a sibling repo `.sops.yaml` (3rd recipient) still gives 2 recipients. Also found: explicit `--age` overrides a repo `.sops.yaml` even with cwd inside the repo.
  3. PASS (decrypt + wrong-key refusal; no stdout). The wrong-key stderr text is **`identity did not match any of the recipients`**, NOT "no matching keys". Step 5 asserts this recorded substring (see Deviation Log D-1).
  4. PASS. `printf '%s\n' "$K" | age-keygen -y` prints the matching recipient.
  5. PASS. A relative `path_regex: secrets/staging\.enc\.yaml$` is picked up by `sops encrypt -i secrets/staging.enc.yaml` from the repo root.
  6. PASS, with a caveat. Single quotes keep `p$w #1 "x"`, `j$t` and `tr ail ` literal. `docker compose config --format json` **re-escapes `$` as `$$`** in its output (`'a$$b'` shows as `a$$$$b`, so it is literal too). The AC-5 assertion decodes `$$`→`$` before comparing.
  7. PASS. `"trail-v \n"` round-trips byte-equal through encrypt → decrypt json.
  8. DEFERRED. `secrets[format()]` under inherit is checked at the first deploy-dev (rollout step 3).
  9. PASS. Local yq = mikefarah v4.53.6.
- Created `scripts/sops-secrets.test.sh` (skeleton + group `action`). TDD RED: `ASSERT FAIL: action: .github/actions/setup-sops/action.yml does not exist` (exit 1). Lint: shellcheck + shfmt -i 2 clean.
- Files modified: `scripts/sops-secrets.test.sh`, `context.md`
- Deviations: D-1 (AC-1 stderr wording)

### Step 2 — Composite action `setup-sops` [done]
- Created `.github/actions/setup-sops/action.yml` (composite, one step, pins in env, no `uses:`). TDD: RED was Step 1's `action` group (action.yml absent).
  GREEN `action: ok`. The real install block, run in the ephemeral sandbox, verified both checksums, and sops 3.13.3 / age v1.3.2 were installed.
- Files modified: `.github/actions/setup-sops/action.yml`
- Deviations: none

### Step 3 — Resolver cases (group `resolve`) [done]
- Added the shared helpers (throwaway age keys, enc_json, fixture CA, an env -i library driver, the homelab CLI driver, a heredoc parser,
  only_masked/masks_first) plus 13 cases covering AC-5/9/10/13/18/22/23, no-normalisation and the leak canary.
- TDD RED: `ASSERT FAIL: 1: resolve failed (… ModuleNotFoundError: No module named 'sops_secrets')`. Lint: shellcheck + shfmt clean.
  A file-level `shellcheck disable=SC2015,SC2016` carries its reason: the `A && B || fail` idiom, and literal `$` is test data.
- Interpretations (within the design): an optional absent key reports `absent (optional)`, since the design names only `sops|github|MISSING`
  and MISSING is reserved for required keys. "Value never appears" means a value appears only on `::add-mask::` lines; masking must echo the
  value to the runner, which consumes those lines.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none
