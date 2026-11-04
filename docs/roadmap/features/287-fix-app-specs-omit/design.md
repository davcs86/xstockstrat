# Design: fix-app-specs-omit

**Created**: 2026-11-04
**Rounds**: 5. Invoked as `quick`; the operator chose "Run another round" at every gate until the cap. Termination: approved.
**Approved by**: user @ 2026-11-04
**Grounded in**: recon.md

---

## Chosen Approach

This is the consolidated design after five proposer/adversary rounds. The text below is the approved
synthesis, including the round-5 amendments and the two final fixes. Line references point to
`recon.md` § Codebase Map.

### Specs
`.do/app.yaml` and `.do/app.dev.yaml`: after `region: nyc` add
```yaml
vpc:
  id: YOUR_VPC_ID
```
Don't mention the token anywhere else in the spec.

### Renderer `scripts/do-render-app-spec.py`
- Add required `--vpc-id`.
- After the name check, before `sops_secrets.resolve`:
  - require a lowercase 8-4-4-4-12 UUID;
  - require `text.count("YOUR_VPC_ID") == 1`.
  - Failures raise `SecretError`; the message names `YOUR_VPC_ID`. No mask output, no `--out`.
- Fill: `.replace("YOUR_VPC_ID", vpc)` in the existing literal chain.
- Leftover guard:
  - names = `YOUR_[A-Z0-9_]+` tokens found in the spec before substitution;
  - report any of those names still present after substitution;
  - otherwise, if any `YOUR_[A-Z0-9_]+` remains, report only `N placeholder-like token(s) remain (values withheld)`;
  - never echo rendered text.

### `scripts/do-db-cluster.sh` (new; bash 3.2; `set -euo pipefail`; shellcheck + `shfmt -i 2`)
Helpers:
- `die`: prints `::error::` only when `GITHUB_ACTIONS` is set; always writes to stderr; exit 1.
- `out k v`: prints `k=v` to stdout, and also to `GITHUB_OUTPUT` when set.
- `summary`: writes to `GITHUB_STEP_SUMMARY` when set.
- `check_ids`: one UUID regex (the same form as the renderer).
- Requires jq, and mikefarah yq checked via `case "$(yq --version 2>&1)"`.

Subcommands:
- **`lookup`** (env `SPEC`):
  - `[.databases[].cluster_name | select(. != null)] | unique` must be exactly 1;
  - `doctl databases list -o json`, selected by name, must be exactly 1 ("expected exactly 1 … found N");
  - validate `id` and `private_network_uuid`;
  - `out cluster_id`, `out vpc_id`.
  - Header note: prod-down needs only `cluster_id`, but lookup also requires a VPC. Its continue-on-error plus the summary covers that.
- **`trust <cid> <app>`**:
  - list the rules once (on failure, die "… re-run Prod — bring up");
  - empty list: `::warning::` "cluster open to all; not restricting it", `out appended false`, rc 0;
  - already present: `out appended false`;
  - otherwise append (on failure, die "… re-run Prod — bring up"), then `out appended true`.
- **`untrust <cid> <app>`**:
  - list the rules once;
  - match `type == app` and `value == app`;
  - no match: rc 0;
  - if removing would empty the list: summary line + die;
  - otherwise remove each match by UUID; on failure, summary line naming the UUID + die.

### deploy.yml (reusable; staging + prod updates)
- New step `id: db` between setup-sops and render: `env SPEC: ${{ inputs.app_spec }}`, `run: bash scripts/do-db-cluster.sh lookup`, no continue-on-error.
- Render: add `VPC_ID: ${{ steps.db.outputs.vpc_id }}` and pass `--vpc-id "$VPC_ID"`.
- No firewall change here (staging's rule already exists).

### prod-up.yml
1. **check**: 0 or 1 apps allowed; more than 1 fails ("expected at most 1 …"). When one exists, print "already exists — ensuring it is a trusted source; redeploys only if that changes the firewall".
2. **db**: ungated lookup.
3. **render**: gated as today; gains `--vpc-id`.
4. **create**: gated as today.
5. **assign**: as today.
6. **trust**: `env CLUSTER_ID`, `APP_ID = create || check`.
7. **wait**: runs only `if: steps.create.outputs.app_id != '' || steps.trust.outputs.appended == 'true'`, so an existing-app no-op stays exactly as today. Env: `APP_ID`, `CREATED`, `APPENDED`. Loop:
   - re-list until a deployment exists (tolerate 4 empty polls);
   - ACTIVE → exit 0;
   - ERROR → one redeploy (`new=$(create-deployment …)`; empty → exit 1; pin new), else exit 1;
   - CANCELED → exit 1;
   - SUPERSEDED → follow the newest;
   - 60×15 s timeout → `::warning::`, rc 0. This is deliberately asymmetric with deploy.yml's exit 1: prod-up is attended, and Report must still print the URL.
   - No `shell:` key.
8. **report**: same `if` as wait.
9. **rm -f**: the only `always()` step, unchanged. No new `uses:`.

### prod-down.yml (one job)
- `permissions: contents: read`; pinned checkout and doctl; keep `if: confirm == 'destroy-prod'`.
- Steps:
  1. find: more than 1 → error; 0 → "already down".
  2. delete: hard; `if app_id`.
  3. db lookup: continue-on-error; `if app_id`.
  4. untrust: continue-on-error; `if app_id && cluster_id`.
  5. summary: `if always() && app_id && delete.outcome == success && untrust.outcome != success`. The remediation text says "cluster lookup failed" when db failed, and never contains an empty cluster ID.
- Header and echo: "cluster data untouched; only the app's trusted-source rule removed".

### ci.yml
The `sops` path filter adds `scripts/do-db-cluster.sh` (step 1) and `.github/workflows/prod-down.yml` (step 4).

### Tests `scripts/sops-secrets.test.sh`
- One `FIXTURE_VPC` UUID.
- `rnd` passes `--vpc-id "${RND_VPC-$FIXTURE_VPC}"`; the empty case uses a one-shot `RND_VPC= rnd …`.
- REVMAP gains a 6th argv slot for the VPC; both call sites pass it.
- **AC-1**: `yq e '.vpc.id'` == `FIXTURE_VPC` on both rendered specs.
- **AC-2**: empty / non-UUID / block deleted / block doubled. Mutated copies live under `$work` only. Each case: rc 1, message names `YOUR_VPC_ID`, no `--out`, no `::add-mask::`.
- **Leak case**: secret sentinel `YOUR_PROD_LEAKED`. The `::error::` and stderr carry the count and "values withheld" and not the sentinel; no `--out`.
- **group_dbnet** (the script, direct; `PATH="$work/stub:$PATH"`; argv-logging doctl stub):
  - lookup: 0 / 1 / 2 clusters, decoy, empty VPC, two `databases` entries (same vs. different cluster);
  - trust: absent → append + `appended=true`; present → `false`; empty list → warning, rc 0, no append; list failure → rc≠0, no append, re-run hint;
  - untrust: match → remove; no match → rc 0; last rule → refuse; remove failure → summary.
- **group_deploy**: db < render < update; db has no continue-on-error; render carries `--vpc-id "$VPC_ID"`.
- **group_produp**:
  - step order;
  - check with 0 / 1 / 2 apps;
  - wait/report `if`;
  - wait has no `shell:`;
  - wait run extracted and run via `env -i PATH="$work/stub:$PATH" HOME=… bash -e`, with doctl + sleep stubs and call-log asserts. Cases: ACTIVE; ERROR→ACTIVE (CREATED); ERROR→ACTIVE (APPENDED); ERROR with neither → exit 1 with 0 creates; ERROR→ERROR; SUPERSEDED→ACTIVE; CANCELED; create rc≠0; create empty; empty list ×2 then present;
  - existing pins kept.
- **group_proddown**: pins; permissions; job `if`; step order and `if`s; continue-on-error flags (none on delete); summary `if`; forbidden-verbs regex.
- Register `dbnet` and `proddown` in the default list.

### Docs / skill
- `docs/setup/digitalocean.md`:
  - Steps 5 and 6: lookup, plus `-e "s|YOUR_VPC_ID|$vpc_id|g"`, plus create with `--format ID --no-header`, then trust.
  - Step 8: the raw update goes; point to the workflows instead.
  - Rename `db` → `xstockstrat`.
  - Token needs database read (deploy) and read+update (prod-up/down).
  - Note that `db-connect.sh` read-modify-write is a hazard.
- `.claude/skills/digitalocean-setup/SKILL.md`:
  - P4/P5: same as Steps 5/6.
  - P6: point to the workflows.
  - P7: spec-based.
  - P0b: rename `db` → `xstockstrat`.
- `docs/runbooks/infra-cost-reduction.md`:
  - update the lifecycle rows;
  - "data untouched, only the app's rule removed";
  - validation caveat;
  - an existing app picks up `vpc:` on its next deploy-prod.

### Step split
1. Script + group_dbnet + CI filter (script).
2. Atomic placeholder change:
   - specs + renderer + render tests;
   - deploy.yml db + `--vpc-id`;
   - prod-up db + `--vpc-id`;
   - group_deploy/produp render-wiring asserts.
3. prod-up check / trust / wait / report + produp asserts.
4. prod-down + group_proddown + CI filter (prod-down).
5. Docs / skill + context teardown.
6. Full suite + ruff + shellcheck + shfmt.

### Residual risks
- **Token scope**: operator pre-merge check, a conditional @AC-8 precondition.
- **PRE_DEPLOY race**: mitigated by one redeploy.
- **Firewall read-modify-write**: concurrent edits are possible.
- **Staging canary**: if DO rejects `vpc:` on update, deploys fail closed.
- **VPC network path**: it is unconfirmed whether VPC + public host changes the network path.
- **Stale rule**: possible after a failed untrust; the summary names the UUID.

### Round-5 amendments (adopted)
- **A1. Report app ID.** Report uses `env APP_ID: ${{ steps.create.outputs.app_id || steps.check.outputs.app_id }}`, the same expression as trust and wait.
- **A2. No inline expressions in extracted runs.** The wait and report `run:` scripts must contain no `${{`; values come only from step `env:`. Asserted.
- **A3. prod-up wiring asserts.**
  - trust `env.APP_ID` and `env.CLUSTER_ID` expressions;
  - trust runs `do-db-cluster.sh trust` and has no continue-on-error;
  - db has no continue-on-error and no `if`.
  setup-sops stays gated, between db and render, so the `uses:` order pin is unchanged.
- **A4. Register groups with their steps.** `dbnet` joins the default group list in step 1 and `proddown` in step 4, because unknown groups fail hard.
- **A5. dbnet harness.** Run the dbnet cases under `env -i PATH="$work/stub:$PATH" HOME=…`. Set `GITHUB_ACTIONS=true` only in the `::error::` cases. Point `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` at files under `$work`.
- **A6. Leak-test scope.** Check only the `^::error::` lines in stdout plus stderr. `::add-mask::` legitimately contains the sentinel.
- **A7. REVMAP and yq.** REVMAP has a single call site (`:508`); its argv slice becomes `[1:7]` and its base replaces `YOUR_VPC_ID`. Add `yq` to group_render's `need`.
- **A8. Empty cluster list.** lookup uses `(. // [])[]`, and the 0-cluster stub covers both `[]` and `null`.
- **A9. Check-step message.** "already exists — ensuring it is a trusted source; redeploys only if the rule was just added and the latest deployment failed".
- **Final-round fixes (adopted).**
  - The wiring asserts are extended to prod-down and deploy:
    - db `env.SPEC`: `.do/app.yaml` in prod-up and prod-down, `${{ inputs.app_spec }}` in deploy.
    - untrust `env.APP_ID` = `${{ steps.find.outputs.app_id }}`.
    - `env.CLUSTER_ID` = `${{ steps.db.outputs.cluster_id }}`.
    - untrust's run calls `do-db-cluster.sh untrust`.
    - No `${{` appears in any extracted `run:`.
  - `(. // [])` is applied to the firewall-rules list in both trust and untrust. The empty-list stubs cover both `[]` and `null`.

## Rejected Alternatives

- **Literal VPC UUID in both specs.** This drifts if the cluster is recreated, and operator decision 1 asks for a lookup instead.
- **SOPS `digitalocean.VPC_ID` key.** Decision 1 allows it only as a fallback. doctl provides `private_network_uuid` (upstream godo `Database.PrivateNetworkUUID`), so not building it is YAGNI. The SOPS key is the follow-up if a lookup ever comes back empty.
- **Private DB hostname.** Out of scope per decision 2.
- **Composite action for the lookup.** It would break `group_produp`'s exact `uses:` pin, and it is less stub-testable than a script.
- **Renderer calls doctl itself.** That couples the hermetic `env -i` renderer tests to the DO API. prod-down needs only `cluster_id` and never renders, so a shell helper is needed anyway.
- **Untrust before delete in prod-down.** If the delete then failed, a live app would be left with no DB access. Delete runs first, and the rule can still be found by app ID afterwards.
- **Hard-fail untrust.** A red teardown invites a re-run, but the re-run finds "already down" and cannot clean up. Instead: best-effort untrust, plus a step-summary entry that names the remediation.
- **Manual remediation for the PRE_DEPLOY race.** Rejected. A re-run of prod-up would skip everything ("already running"), so the workflow does one automatic, gated redeploy instead.
- **Trust in deploy.yml on every deploy.** It would heal itself, but every staging and prod deploy would gain firewall write rights. Rejected on blast radius.
- **Shared wait-loop script for deploy.yml and prod-up.** The two have different timeout semantics: deploy exits 1, while prod-up warns and still reports the URL. Unifying them would change one workflow's behaviour.

## Open Risks

- **Token scope.** This is a conditional precondition for @AC-8.
  - `deploy.yml` now calls `doctl databases list`, and prod-up/down call `firewalls list/append/remove`.
  - A custom-scoped `DIGITALOCEAN_ACCESS_TOKEN` without database read/update fails closed at the lookup on every deploy.
  - The operator verifies this before merge.
- **PRE_DEPLOY race.** The rule can only be appended after `apps create`. The mitigation is one gated redeploy; it is not eliminated.
- **Read-modify-write on firewall rules.** doctl `firewalls append/remove` re-read and rewrite the whole rule list. A concurrent `scripts/db-connect.sh` session or a console edit can therefore be lost. This is documented.
- **VPC acceptance.** If App Platform rejects `vpc:` (app region `nyc`, cluster `nyc1`), every deploy fails closed until reverted. The first staging deploy after merge is the canary.
- **Network path.** It is unconfirmed whether VPC attachment plus the public host changes the network path. The trusted-source rule is what definitely gates public-host traffic.
- **Existing prod app.** It picks up `vpc:` only on its next deploy-prod, because render stays gated in prod-up.
- **prod-up with an existing app.** It now runs lookup and trust, so a token-scope failure fails a run that used to be a no-op.
- **Stale rule.** One can remain after a failed untrust, and a re-run cannot find the old app ID. The step summary names the rule UUID.
- **DO self-cleanup on delete.** If DO removes the app's rule itself when the app is deleted, a remove can 404 and raise a false stale-rule summary. The job outcome is unaffected.
- **Secret values containing `YOUR_`.** The widened leftover guard fails such a render, with the value withheld. Negligible likelihood; fails closed.
- **Runner tools.** The script needs the jq and mikefarah yq that ship on ubuntu-latest. A version check fails closed if they are missing.

## Constitution Rules Touched

- **F-02/F-03**: the PR targets `main-dev` from `feature/fix-app-specs-omit`. Never push directly.
- **F-04**: every path and verb is grounded in recon or in verified upstream doctl/godo source.
- **F-05**: each step passes its own verification. Test groups are registered in the same step that defines them (A4).
- **F-07**: not applicable. The VPC and cluster IDs are deploy-pipeline values from the DO API, not service config. The cluster name comes from the spec.
- **C-15**: AC-1..AC-4 each map to executable tests (render, dbnet, produp, proddown).
- **C-16**: @feature-286 rules are preserved, and AC-16 is extended. See below.
- **C-18**: one helper script with three verbs. No composite action and no SOPS key. Every adversary YAGNI check passed.
- **P-01/P-02**: the orchestrator is the only writer and mediated every round.
- **P-06**: red-before-green. Tests come first in each step.

## Business Rules Touched (C-16)

- **PRESERVE** (all in `docs/sdd/business-rules/platform.feature`):
  - @feature-286: @AC-8, @AC-9, @AC-10, @AC-11, @AC-17, @AC-21, @AC-22, @AC-24
  - @feature-147: @AC-8
  - @feature-266: @AC-5
  - @feature-210: @AC-4
  - @feature-286 @AC-8 carries one new precondition, token database scope (see Open Risks).
- **EXTEND**: @feature-286 @AC-16. No placeholder may remain in the rendered spec, and `YOUR_VPC_ID` now joins that rule (this feature's AC-1/AC-2).
- **NEW**: this feature's AC-3/AC-4 (trusted-source add/remove). They are promoted at launch.
- **CHANGE**: none.
