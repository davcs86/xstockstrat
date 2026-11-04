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

### Step 4 — `scripts/sops_secrets.py` — KEYS, `resolve`, homelab CLI [done]
- Stdlib-only module: the KEYS table (11 common + digitalocean.PROJECT_ID + 5 homelab), `resolve()`, and the homelab `resolve` CLI (APP_ENV body + DO tail;
  6 heredocs).
- TDD GREEN: `resolve: ok`. Mutation check: five mutants (mask floor, legacy strip, tail order, AC-23, differs) were each killed by the expected case.
  ruff check + format clean.
- Hardening beyond the step text, within its intent: `::add-mask::` data is escaped (`%`→`%25`, `\r`, `\n`) because GitHub unescapes
  command data. Without that, a value containing `%` (e.g. percent-encoded OTEL headers) would register the wrong mask and stay visible.
- Files modified: `scripts/sops_secrets.py`
- Deviations: none

### Step 5 — Bootstrap `build` + `sops-config` cases (group `build`) [done]
- Added mkrepo (a scratch clone whose origin is a local bare repo), the bld/dec helpers, and cases 1–9 (AC-1/2/6/7/15/20, absent optional, no-normalisation, fetch
  failure, sops-config). Case 2 asserts the recorded D-1 text `identity did not match any of the recipients`.
- Made the file bash 3.2-portable (root CLAUDE.md macOS rule): no `mapfile` and no negative array index.
- TDD RED: `ASSERT FAIL: 1: build failed (… invalid choice: 'build')`. shellcheck + shfmt clean.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 6 — `scripts/sops_secrets.py` — `build` and `sops-config` CLIs [done]
- `build`: masks first; the force guard (`git fetch --depth=1 origin main-dev`, where a fetch failure is an error and never "absent"); the required check; the env
  recipient via `age-keygen -y`; JSON → `sops encrypt` with cwd=$RUNNER_TEMP; an in-memory self-verify before any file is written; a names-only
  `changes.md` on force. `sops-config` prints the two `creation_rules`.
- TDD GREEN: `resolve: ok`, `build: ok`. The first green attempt failed self-verify. The cause was sops 3.13 listing `enc:` before `recipient:` in each age entry,
  so the recipient regex now allows an optional `- `. The test's AC-1 recipient check caught it. Mutation check: guard, fetch-failure,
  required-check and normalisation mutants were each killed. ruff check + format clean.
- Files modified: `scripts/sops_secrets.py`
- Deviations: none

### Step 7 — DO renderer cases (group `render`) [done]
- Hermetic copy under `$work/repo/scripts/`, plus fixed-width `__S286_NN__` sentinels. AC-8 reverse substitution runs as one `python3 -I` heredoc (REVMAP):
  - same line count; every changed line must be a `value: YOUR_*` placeholder line carrying its own key's value;
  - exact CA `yaml_pem`; for each of the 12 leaves, a PEM shape check, the SAN `xstockstrat-<sfx>`, `openssl verify` against the fixture CA, and a key/cert pubkey match.
  Also covers the AC-9/10/11/16 cases, OTEL prefix both ways, absent optional → empty, the `${xstockstrat.CA_CERT}` count, 0600 mode, GITHUB_OUTPUT keys,
  masks for every sentinel and yaml_pem string, and an app-name mismatch.
- TDD RED: `cp: cannot stat 'scripts/do-render-app-spec.py'` → `ASSERT FAIL: render: copy scripts`. shellcheck + shfmt clean.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 8 — `scripts/do-render-app-spec.py` (unified DO renderer) [done]
- Replaces the deploy.yml inline python and `do-inject-prod-secrets.py` (deleted in Step 12). It checks the name, fills placeholders through one anchored regex
  plus a lookup (no replace-order dependence), mints the CA plus 12 leaves in a temp dir (MTLS_CA only in the subprocess env), masks every yaml_pem string and
  PEM line, runs a global leftover check, writes the spec 0600 to --out, and puts app_name/project_id in GITHUB_OUTPUT.
- TDD GREEN: `resolve: ok`, `render: ok`. Mutation check: crossed JWT↔BROKER, swapped leaf keys, swapped leaf certs, OTEL prefix and the PEM mask were each
  killed by the reverse-substitution/mask assertions. ruff check + format clean.
- PARITY RECORD (one-time, design Risk 2): the `HEAD` deploy.yml inline python (67 lines, extracted verbatim) and the new renderer were run on both real specs
  with the same values and the same CA. Two value sets were used: all 10 keys set, and only the required keys. Leaf PEMs were normalised; the CA was compared separately
  (12/12 identical copies in every render).
- PARITY RECORD (286 step 8): identical
- Files modified: `scripts/do-render-app-spec.py`
- Deviations: none

### Step 9 — Static rules for `deploy.yml` and its callers (group `deploy`) [done]
- Shared helpers: `expected_legacy` (exact LEGACY_ line texts derived from KEYS, giving 12 for DO and 14 for homelab), `check_legacy`, `check_p`, `no_unprefixed`.
  Group `deploy`: yq parse, LEGACY_ RHS pins, a single job-level P, no unprefixed common secrets, no DO_*APP_ID, no workflow_call secrets, the environment
  input plus binding, a validate job, and AC-17/AC-21 run permanently through the extracted `resolve-app-id` step against a stub doctl (0/1/2 matches, `bash -eo pipefail`
  like Actions). Callers use `secrets: inherit` and `with.environment`, with the homelab jobs and gates intact (content assertions).
- TDD RED: `ASSERT FAIL: deploy: LEGACY_ lines in .github/workflows/deploy.yml differ from KEYS` (none exist today). shellcheck + shfmt clean.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 10 — Rewrite `deploy.yml`; callers to `secrets: inherit` [done]
- `deploy.yml`:
  - the `workflow_call.secrets` block (incl. DO_APP_ID) is gone; there is an `environment` input and a `validate` job with no environment;
  - `deploy` is bound to `environment: ${{ inputs.environment }}`, with `contents: read`;
  - job env has `P` and `APP_NAME`; checkout and doctl are SHA-pinned;
  - `resolve-app-id` runs before any decrypt, then setup-sops, then the render (12 pinned LEGACY_ lines + SOPS_AGE_KEY), then update/assign/wait via
    `$APP_ID`, and finally an always-run spec removal.
- `deploy-dev.yml` and `deploy-prod.yml`: job `deploy` now uses `secrets: inherit` plus `with.environment`. The homelab jobs and gates are untouched.
- TDD GREEN: `deploy: ok` (incl. AC-17/AC-21 stub-doctl cases) and `render: ok`. yq parses all 3 files.
- Files modified: `.github/workflows/deploy.yml`, `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`
- Deviations: none

### Step 11 — Static rules for `prod-up.yml` (group `produp`) [done]
- Checks:
  - 12 literal-PROD LEGACY_ pins and the production binding + `contents: read`;
  - exact `uses:` sequence (pinned checkout, pinned doctl, setup-sops);
  - the renderer args, create from `$RUNNER_TEMP/app.yaml`, and the always-run removal;
  - no do-inject-prod-secrets / DO_PROD_APP_ID / MCP_AGENT_SECRET / unprefixed common secret, and the script deleted.
- TDD RED: `ASSERT FAIL: produp: LEGACY_ lines in .github/workflows/prod-up.yml differ from KEYS`. shellcheck + shfmt clean.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 12 — `prod-up.yml` on the unified renderer; delete `do-inject-prod-secrets.py` [done]
- prod-up changes:
  - job `up`: `environment: production` + `contents: read`, with pinned checkout and doctl;
  - setup-sops and the render step (12 literal PROD_ LEGACY_ lines, the full key set incl. VAPID + MTLS) run only when the app is absent;
  - create from `$RUNNER_TEMP/app.yaml`, with assign using the render output project_id;
  - the DO_PROD_APP_ID warning and the MCP_AGENT_SECRET comment are dropped, the header is rewritten, and an always-run spec removal is added.
- `git rm scripts/do-inject-prod-secrets.py` (its only caller was prod-up.yml:60).
- TDD GREEN: `produp: ok`, `render: ok`. yq parses. No repo references remain outside the test file.
- Deliberate behaviour changes (design C5): a missing required key now fails instead of warning; MTLS is required and minted; an absent optional key renders ''.
- Files modified: `.github/workflows/prod-up.yml`, `scripts/do-inject-prod-secrets.py` (deleted)
- Deviations: none

### Step 13 — Static rules for `deploy-homelab.yml` (group `homelab`) [done]
- Checks:
  - AC-12: case-sensitive `\bop\b|\bOP_` and case-insensitive `1password|load-secrets-action` both find nothing;
  - 14 LEGACY_ pins (9 common read via DEV_/PROD_ format, 4 same-named secrets, 1 var) and a single job-level P;
  - no unprefixed common secrets; a validate job;
  - resolve comes before the image-commit detach, with no `uses:` after resolve.
- TDD RED: `ASSERT FAIL: homelab: AC-12 op/OP_ reference remains`. shellcheck + shfmt clean.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: none

### Step 14 — `deploy-homelab.yml` drops 1Password and resolves via SOPS [done]
- Header rewritten; OP_CLI_* pins and the 1Password src/opcli/op/report steps deleted. New `validate` job, and `deploy` needs it; job env P.
- The image-tag validation step keeps its guards and exports, but no longer detaches.
- Then setup-sops and resolve (14 pinned LEGACY_ lines; writes the 6 values to GITHUB_ENV, per the operator waiver), then a separate detach step plus the predates check.
- The expiry gate, release env, join and SSH steps lose their `env:` blocks and read GITHUB_ENV.
- TDD GREEN: `homelab: ok`, `resolve: ok`; `homelab-render.test.sh` (279 contract) still passes; yq parses.
- Files modified: `.github/workflows/deploy-homelab.yml`
- Deviations: none

### Step 15 — Static rules for `sops-bootstrap.yml` + groups `ac24`, `cleanup` [done]
- `bootstrap` checks:
  - the boolean force input and contents: read;
  - the exact matrix pairs with no extra axes, fail-fast, and the seed environment binding;
  - 12 LEGACY_ pins with matrix.prefix and the operator recipient var;
  - pinned upload with retention 1; pr needs seed;
  - GH_PAT guard, pinned download, sops-config, force-with-lease, `gh pr create --base main-dev`, and the main-dev checkout;
  - no trunk push (F-02).
- `ac24`: MCP_AGENT_SECRET is absent from the named surfaces (each must exist) and from existing secrets/*.enc.yaml (the accepted carve-out), and the old script is gone.
- `cleanup`: no DO_*_APP_ID; the REQUIRED_SECRETS literal; the mtls-provision header assertion (narrowed, D-2).
- TDD RED, all three groups:
  - bootstrap: `sops-bootstrap.yml does not exist`;
  - ac24: the same (it runs after Step 16, then Step 17 clears the .do comments);
  - cleanup: `DO_*_APP_ID still referenced`.
- Blocker → operator: narrow the cleanup header check (D-2). shellcheck + shfmt clean.
- Files modified: `scripts/sops-secrets.test.sh`
- Deviations: D-2

### Step 16 — New `sops-bootstrap.yml` [done]
- Created the workflow:
  - workflow_dispatch with a boolean force, contents: read;
  - `seed`: pinned matrix {staging/DEV, production/PROD}, fail-fast, env-bound. It runs setup-sops, then `build` with 12 LEGACY_ (matrix.prefix) + SOPS_AGE_KEY + the operator var,
    then a pinned upload (ciphertext + recipient + names-only changes, retention 1);
  - `pr`: a GH_PAT guard, then a main-dev checkout with GH_PAT and a pinned download, then `.sops.yaml` via `sops-config`. The bot commits on `chore/sops-bootstrap`,
    fetches the refspec, pushes with force-with-lease and retry, and edits or creates the PR to main-dev.
- TDD GREEN: `bootstrap: ok`, `build: ok`; no trunk push; yq parses.
- gitleaks (conditional `.gitleaks.toml`, design Risk 5): gitleaks is not installed locally, so the check was not run here. It moves to the integration PR's CI
  `secret-scan` job. If that job flags `secrets/*.enc.yaml` / `.sops.yaml`, the bootstrap PR (where those files first appear) gets the allowlist. `.gitleaks.toml` is unchanged.
- Files modified: `.github/workflows/sops-bootstrap.yml`
- Deviations: none

### Step 17 — Comment and secret-name cleanup in scripts and app specs [done]
- `.do/app*.yaml` headers: the project ID lives in `secrets/<env>.enc.yaml` with a legacy fallback, and the app is found by name. The agent comment no longer names the retired secret.
  `do-setup-check.sh` REQUIRED_SECRETS no longer lists DO_*_APP_ID. The `mtls-provision.sh` header/usage now say `common.MTLS_CA` is shared by DO and homelab, with set-secret
  as the legacy fallback. The dev/prod separate-CA sentence is kept (D-2). No behaviour changed.
- TDD GREEN: `ac24: ok`, `cleanup: ok`, `render: ok` (RED was Step 15). shellcheck + shfmt clean.
- Files modified: `.do/app.yaml`, `.do/app.dev.yaml`, `scripts/do-setup-check.sh`, `scripts/mtls-provision.sh`
- Deviations: none

### Step 18 — CI job `sops-secrets`, `sops` filter, ci-gate; `.gitignore` [done]
- ci.yml:
  - filter key `sops` (the two scripts, the test, the setup-sops action, deploy*/prod-up/sops-bootstrap workflows, `.do/**`, `.sops.yaml`, `secrets/**`);
  - job `sops-secrets` (ubuntu-24.04, gated `sops || homelab || ci`) runs setup-sops, then setup-python + ruff on the 2 scripts, then the whole test file;
  - added to the ci-gate needs and echo.
- .gitignore: `*.agekey`, `keys.txt`.
- Verification:
  - full suite green locally: all 10 groups, ~24 s;
  - per-path check-ignore OK (keys.txt/x.agekey ignored; secrets/staging.enc.yaml and .sops.yaml are not);
  - yq parses ci.yml.
  The first real CI run happens on the integration PR.
- Local shellcheck 0.9.0 flags two pre-existing SC2015 infos in `scripts/homelab-render.test.sh`, which is unchanged against main-dev. CI's shell-lint passed with that file on
  #1327, so it's a local-version difference. Not touched (out of scope).
- Files modified: `.github/workflows/ci.yml`, `.gitignore`
- Deviations: D-3 (ruff install via setup-python)

### Step 19 — Operator runbook `docs/runbooks/sops-secrets.md` [done]
- Created the runbook:
  - a namespace/key table and the resolution model;
  - Key generation (brew; keys outside the repo) and Environment setup (gh secret/variable plus both preflight lists);
  - Bootstrap (promotion first, the prod reviewer pause, force semantics) and Local edit;
  - Rotation (`sops set`, mTLS CA, never the encryption keys) and Adding a key (4 touch points);
  - Homelab enablement (Risks 3/4/6), Production reviewer gate (Risk 8) and Legacy-secret removal.
  Added the index row to `docs/runbooks/CLAUDE.md`.
- Verification: all required sections present, `brew install sops age`, no GNU-only/bare-pip commands, markdownlint-cli2 0 issues (AC-14 inspection).
- Files modified: `docs/runbooks/sops-secrets.md`, `docs/runbooks/CLAUDE.md`
- Deviations: none

### Step 20 — Docs sweep of the `docs/` tree [done]
- `docs/setup/digitalocean.md`:
  - the Key Identifiers note: the app is found by name, so the app ID is not a secret;
  - the mTLS CA is `common.MTLS_CA`, shared by DO and homelab;
  - JWT now comes from SOPS;
  - the Step 9 secrets table is rebuilt: stale ALPACA/FMP/FINNHUB and DO_*_APP_ID rows dropped, SOPS_AGE_KEY / SOPS_OPERATOR_AGE_RECIPIENT / GH_PAT added, CONFIG/VAPID/OTEL/MTLS covered, DEV_/PROD_ rows marked legacy-fallback-only;
  - the "how secrets are used" block now covers `secrets: inherit`, render and name resolution.
  Operator shell-variable usages (`export DO_DEV_APP_ID=…` for manual doctl) are kept.
- Other docs:
  - `inter-service-mtls.md`: unified CA (reverses :105).
  - `inter-service-mtls-rollout.md`: CA table.
  - `ci-overview.md`: `sops-secrets` job row and deploy targets.
  - `feature-workflow.md` and `launch-pdfs/infra-ci.md`: deploy diagrams.
  - `add-data-source.md`: rows 5–8 are now the KEYS tuple + sops set + runbook row.
  - `grafana-cloud.md`: the renderer and the OTEL prefix.
  - `infra-cost-reduction.md`: bring-up secrets and caveats (stale ALPACA/MCP_AGENT_SECRET removed, app-ID caveat replaced by name resolution + reviewer gate).
- Verification: the grep leaves only intended mentions (operator shell vars, runbook legacy-removal/preflight, the explicit reversal note). markdownlint
  findings are unchanged or fewer per file versus main-dev.
- Out of scope, noted: `docs/setup/digitalocean.md` § "MCP agent secret" still documents the removed `MCP_AGENT_SECRET` (stale since feature 147).
  It is not part of this feature's surfaces; queued as a separate task.
- Files modified: the 9 `docs/` files listed in Step 20
- Deviations: none

### Step 21 — Remaining surfaces + CLAUDE.md teardown [done]
- `.env.example` and `setup-env.sh` comment tables: DO_*_APP_ID replaced by SOPS_AGE_KEY. The digitalocean-setup skill:
  - P8 detection and the summary no longer list app-ID secrets;
  - the `gh secret set DO_*_APP_ID` lines are removed;
  - the mTLS CA becomes `common.MTLS_CA`, with set-secret as the legacy fallback, plus a pointer to the runbook's key/env/bootstrap sections.
  The identity CLAUDE.md + operations.md use `common.JWT_SECRET` with the legacy fallback. The notify CLAUDE.md names the renderer and the runbook.
- **Teardown (manual).** The context-forge plugin offers only `context-scrubber` in this session; `/context-forge:context-constitution refresh` is unavailable.
  Manual reconciliation:
  - re-read the touched context files (`docs/runbooks/CLAUDE.md`, `services/xstockstrat-identity/CLAUDE.md`, `services/xstockstrat-notify/CLAUDE.md`) and
    the root `CLAUDE.md` against the current code;
  - grepped every `CLAUDE.md`, `docs/context-constitution.md`, all 14 per-module `context-constitution*.md`, `README.md` and the scrubber extra targets for the
    retired names and for `#anchor` citations into every file this feature changed.
  Exactly one grounded drift was found and fixed: the dead anchor `docs/context-constitution.md:83` (D-4). No other drift.
- Verification: the grep leaves only explicit legacy-fallback lines; setup-env.sh shellcheck + shfmt clean; markdownlint 0 issues on the touched CLAUDE.md files.
- Files modified: `.env.example`, `scripts/setup-env.sh`, `.claude/skills/digitalocean-setup/SKILL.md`, `services/xstockstrat-identity/CLAUDE.md`,
  `services/xstockstrat-identity/docs/operations.md`, `services/xstockstrat-notify/CLAUDE.md`, `docs/context-constitution.md` (teardown, D-4)
- Deviations: D-4
- Config-key wiring gate `node scripts/check-config-wiring.mjs --final`: exit 0. Its only line is a pre-existing baseline report (`trading.fill_poller.interval_ms:read-unseeded:production`), unrelated; this feature declares no config keys.

## Session 2026-11-04 — sdd-execute integration (C-16 promotion + pre-PR checks)

- Merge-order gate: no `merge-order.md` entry for 286. The textual ci-gate overlap with 278/281 is recorded in the spec (finding 6).
- C-16 promotion (operator-confirmed): 21 active scenarios (AC-1, 2, 5–18, 20–24) appended to `docs/sdd/business-rules/platform.feature`, tagged `@feature-286`.
  @AC-24 extends platform @AC-8 @feature-147. AC-1's Then was reconciled to the real sops text in both copies (D-1). No duplicates.
- Pre-PR CI-equivalent checks: sops-secrets suite (10 groups), otel-signals check + test (57/57), context-map, workflow-tests (4/4), CLAUDE.md
  markdownlint and ledger-guard are all green.
- otel-signals initially failed on my Step 20 wording `secrets/<env>.enc.yaml` in `docs/setup/grafana-cloud.md:169`. Its rule P3-file requires `.yaml` tokens in
  observability docs to name real files. The wording is now "the environment's SOPS file under `secrets/`". It was a fix of the step's own change, re-verified.

## Session 2026-11-04 — sdd-execute (sequential) — summary
**Steps this session**: 1–21
**Progress**: 21 done / 21 total
**Stopped at**: all complete; integration PR https://github.com/davcs86/xstockstrat/pull/1405 (subscribed for CI)
**Deviations**: D-1 (sops wrong-key text), D-2 (cleanup header check narrowed, operator), D-3 (ruff via setup-python), D-4 (teardown anchor fix)
**Open Threads still live**:
- [ ] rollout step 3: confirm `secrets[format()]` under inherit (first deploy-dev summary shows `github` for every key)
- [ ] secret-scan on the bootstrap PR: allowlist the age armor in `.gitleaks.toml` if it flags it (Risk 5)
- [ ] homelab enablement: trailing-newline hand-off and `sops set homelab.app_env` first (Risks 3/6)
- [ ] follow-up feature: legacy-secret + 1Password removal
**Next**: merge #1405 when CI passes → operator rollout per docs/runbooks/sops-secrets.md

## Session 2026-11-04 (CI: feature status automation)

- Promotion PR #1406 merged to main
- Feature promoted and committed: 86132e77a5e1a8da3e2b24f2fc58809cfc008d9a
- Status updated: `code-completed` → `launched`
- Launched date: 2026-11-04
