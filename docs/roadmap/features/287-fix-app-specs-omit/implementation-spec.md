# Implementation Spec: fix-app-specs-omit

**Status**: `in-progress`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/287-fix-app-specs-omit/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/fix-app-specs-omit`

---

## Execution Summary

The steps follow the design's six-part split (design.md § Step split). Each code-bearing part becomes a
test step followed by its service step, as in feature 286, so `/sdd-execute` can capture RED on one slice of
`scripts/sops-secrets.test.sh` before the code lands (P-06, C-08).

1. **Steps 1–2** build the new helper `scripts/do-db-cluster.sh` (`lookup` / `trust` / `untrust`) and its
   stub-doctl group `dbnet`.
2. **Steps 3–4** are the atomic placeholder change. Both specs gain `vpc: id: YOUR_VPC_ID`, the renderer gains
   a required, validated `--vpc-id` and a widened leftover guard, and **both** render call sites
   (`deploy.yml`, `prod-up.yml`) gain the `db` lookup step and pass `--vpc-id`. All of this ships in one step
   because a placeholder without every fill site shipped literal tokens once (fails.md 2026-10-07,
   inter-service-mtls).
3. **Steps 5–6** add prod-up's check, trust, gated wait/redeploy and report.
4. **Steps 7–8** rewrite prod-down: delete first, then a best-effort untrust.
5. **Step 9** updates the docs and the skill and runs the context teardown.
6. **Step 10** is the full regression gate.

**Consumer surface: None.** This is internal, platform-only work on the deploy pipeline (product spec §
Affected Services). There are no service runtime, UI or agent changes, so C-14 needs no UI or Agent step.
That is a decision, not an omission.

**Coverage threshold.** `scripts/` and `.github/workflows/` have no CI coverage threshold
(`docs/patterns/ci-overview.md:23`). The hermetic suite `scripts/sops-secrets.test.sh`, plus shellcheck,
shfmt and ruff, is the code-quality gate (C-08).

**Spec-time findings beyond the design (verified 2026-11-04):**

1. **Upstream doctl/godo shapes**, fetched from `digitalocean/doctl@main` and `digitalocean/godo@main`.
   The stubs must emit exactly these shapes.
   - `doctl databases list -o json` emits `writeJSON(d.Databases)` (`doctl/commands/displayers/database.go:33-34`).
     Each element has `id`, `name` and `private_network_uuid`; `private_network_uuid` is `omitempty`
     (`godo/databases.go:228-229,245`). An absent key therefore reads as `null` in jq and must fail the UUID check.
   - `doctl databases firewalls list <cid> -o json` emits `writeJSON(dr.DatabaseFirewallRules)`
     (`displayers/database.go:729-730`). Each element is `{uuid, cluster_uuid, type, value, created_at}`
     (`godo/databases.go:582-588`).
   - `firewalls remove <cid> --uuid <uuid>`: `--uuid` is a required flag (`doctl/commands/databases.go:2485-2487`).
   - `firewalls append <cid> --rule <type>:<value>` (`databases.go:2480`).
   - `doctl apps create-deployment <app id>` (`doctl/commands/apps.go:151`). The Deployments displayer has an
     `ID` column (`displayers/apps.go:81-90`).
   - Deployment phases include `ACTIVE`, `SUPERSEDED`, `ERROR` and `CANCELED` (`godo/apps.gen.go:972-980`).
   - The app spec field is `vpc: {id: <uuid>}` (`godo/apps.gen.go:663,726-729`).
2. **The prod-down doctl action is unpinned** (`prod-down.yml:24` `digitalocean/action-doctl@v2`). The
   design's "pinned checkout and doctl" means Step 8 switches it to `DOCTL_PIN`
   (`sops-secrets.test.sh:683`) and adds `CHECKOUT_PIN` (`:682`). prod-down needs the checkout so it can
   run `scripts/do-db-cluster.sh`.
3. **`scripts/do-db-cluster.sh` is linted without a filter edit.** The `shell-lint` job runs
   `shellcheck scripts/*.sh` / `shfmt -d -i 2 scripts/*.sh` (`ci.yml:664-668`) on the `scripts/**` filter
   (`ci.yml:67-68`). Only the `sops` filter (`ci.yml:86-96`) needs the two additions in Steps 2 and 8.
4. **The digitalocean.md drift goes beyond the `db` component name.** Line 476 says the component name is
   `db`, and the Troubleshooting heading at `:594` still reads `${db.DATABASE_URL}`. Both specs bind
   `${xstockstrat.DATABASE_URL}` (6 occurrences in `.do/app.yaml`, none of `${db.`). Step 9 fixes both. The
   skill repeats the same drift at `SKILL.md:232,566,568`.
5. **Local tooling gap.** This host has no mikefarah yq (`yq --version` prints `yq 0.0.0`, and `need()` at
   `sops-secrets.test.sh:19` rejects it), no sops, no shellcheck and no shfmt. Today the suite fails at
   `need` before any group runs. The executor must install them before Step 1's RED run (macOS:
   `brew install yq sops shellcheck shfmt`; Linux: the mikefarah yq v4 release binary plus distro
   shellcheck/shfmt). sops must be the pinned version: `SOPS_PIN_VERSION=3.13.3`, `sops-secrets.test.sh:26`.
   CI (`ubuntu-24.04`) has all of them, and CI is authoritative.
6. **Render call sites.** A grep of `do-render-app-spec|apps create|apps update` over `.github/workflows` and
   `scripts` finds only `deploy.yml:79,90` and `prod-up.yml:65,77`. The manual (doc) render sites are
   `docs/setup/digitalocean.md:230-231,271-272,466-467` and
   `.claude/skills/digitalocean-setup/SKILL.md:361-366,442-447,506-510`. No other test parses the
   `.do/app*.yaml` `YOUR_` tokens; `check-otel-produced-signals.test.sh:229` only appends an env line.

### Scenario Coverage (C-15)

| AC | Covered by | Kind |
|---|---|---|
| AC-1 | Step 3: `render` group, `yq e '.vpc.id'` == `FIXTURE_VPC` on both rendered real specs; REVMAP parity with the VPC slot | auto |
| AC-2 | Step 3: `render` group (empty / non-UUID / block deleted / block doubled; no `--out`; message names `YOUR_VPC_ID`) plus the `deploy`/`produp` wiring asserts (db step has no `continue-on-error`, db runs before render, render runs before update/create). Step 1: `dbnet` lookup fails on an empty or absent `private_network_uuid` | auto + static |
| AC-3 | Step 1: `dbnet` trust cases (append `app:<id>`, idempotent, empty-list warning). Step 5: `produp` trust wiring and the wait/redeploy run against a stub doctl | auto + static |
| AC-4 | Step 1: `dbnet` untrust cases (remove by UUID, no match rc 0, refuse to empty, remove-failure summary). Step 7: `proddown` (delete then untrust, forbidden-verbs regex: the cluster is untouched) | auto + static |

Live verification is operator-only and is not a step (product spec § Acceptance Criteria): run `prod-up`,
confirm `db-migrator` connects, then run `prod-down`.

## Step Dependencies

- Step 2 [service] is covered by Step 1 [test]. Step 4 by Step 3. Step 6 by Step 5. Step 8 by Step 7.
  Each test step is RED before its service step and GREEN after (P-06).
- Step 1 registers `dbnet` in the default group list (`sops-secrets.test.sh:787`), and Step 7 registers
  `proddown`. An unknown group fails hard (`:789`), so each group is registered in the same step that
  defines it (design A4).
- Step 3/4 require Step 2. The new `db` steps in `deploy.yml` and `prod-up.yml` run `do-db-cluster.sh lookup`.
- Step 4 is **atomic**: specs, renderer, `deploy.yml` and `prod-up.yml` render wiring land in one commit.
  If any part is split off, a deploy renders with an unfilled or unvalidated `YOUR_VPC_ID` (fails.md 2026-10-07).
- Step 5/6 require Step 4 (prod-up's `db` step and `--vpc-id` already exist) and Step 2 (`trust`).
- Step 7/8 require Step 2 (`lookup`, `untrust`).
- Step 9 requires Steps 2–8, because the docs describe the shipped workflows. It closes with the context teardown.
- Step 10 requires Steps 1–9.
- **Operator pre-merge precondition (not a step):** the `DIGITALOCEAN_ACCESS_TOKEN` must have database
  read scope (deploy.yml lookup) and read+update scope (prod-up/prod-down firewall). This is design Open Risk
  "Token scope", a conditional precondition of platform @feature-286 @AC-8. The first staging deploy after
  merge is the `vpc:` canary.

---

### Step 1 — test: `dbnet` group (lookup / trust / untrust against a stub doctl)

**Status**: `done`
**Service**: `scripts/` (deploy pipeline)
**Files**:
- `scripts/sops-secrets.test.sh` — modify (new `group_dbnet`; register `dbnet` in the default list at `:787`)

**Reviewers**: Platform Lead — deploy-pipeline correctness, exactly-one resolution; Security — firewall trusted-source scope (never opens or empties the cluster)

**Codebase Evidence**:
- Stub-doctl run pattern: `sops-secrets.test.sh:638-663` (writes `$work/stub/doctl`, runs `env -i PATH="$work/stub:$PATH" HOME="$HOME" … bash -eo pipefail`, asserts rc + message).
- Exactly-one message form to mirror: `deploy.yml:52-55` (`expected exactly 1 app named $APP_NAME, found $n`).
- Firewall verbs reused by the script: `scripts/db-connect.sh:82-86,95` (`firewalls list … `, `firewalls remove "$CLUSTER_ID" --uuid "$uuid"`, `firewalls append "$CLUSTER_ID" --rule "ip_addr:$IP"`).
- JSON shapes the stub must emit: § Execution Summary finding 1 (godo `Database`, `DatabaseFirewallRule`).
- `need` helper with the mikefarah check: `sops-secrets.test.sh:14-20`. Group dispatch: `:787-791`.
- Spec cluster names: `.do/app.yaml:687-693`, `.do/app.dev.yaml:689-695` (`cluster_name: xstockstrat`).

**TDD**: `red-green required`. RED: `scripts/do-db-cluster.sh` does not exist, so every case fails.

**Covers**: `AC-2, AC-3, AC-4`

**Instructions**:
Add `group_dbnet`, which calls `need yq jq`, and register `dbnet` in the default `groups` list at `:787`.
Run the real `scripts/do-db-cluster.sh` directly (not a copy) with the harness from design A5:

- `env -i PATH="$work/stub:$PATH" HOME="$HOME" GITHUB_OUTPUT="$work/dout" GITHUB_STEP_SUMMARY="$work/dsum" …`
- Set `GITHUB_ACTIONS=true` only in the cases that assert `::error::`.

The stub `doctl` appends its argv to `$work/doctl.log` and answers from fixture files and rc variables in
`$work`:
- `databases list -o json` prints `$work/dbs.json`.
- `databases firewalls list <cid> -o json` prints `$work/fw.json`, or exits `$FW_LIST_RC`.
- `firewalls append` exits `$FW_APPEND_RC`.
- `firewalls remove` exits `$FW_REMOVE_RC`.

Use UUID literals throughout: one cluster ID and one VPC ID
`d7afff57-f807-4893-9fbf-20fff8bb82dd`, the AC-1 value. Define that as `FIXTURE_VPC` once at file scope;
Step 3 reuses it. This is a single consumer file, so it stays inline (C-13). Also define app IDs and a rule UUID.
For `lookup` the spec is a temp file (`SPEC=$work/spec.yaml`) holding a `databases:` list.

Cases:
1. **lookup**
   - Exactly 1 matching cluster: rc 0, and `$work/dout` contains `cluster_id=<cid>` and `vpc_id=<FIXTURE_VPC>`.
   - 0 clusters, with both `[]` and `null` as `dbs.json` (A8): rc≠0 and `expected exactly 1 … found 0`.
   - 2 same-named clusters: `found 2`.
   - A decoy cluster with a different name is ignored.
   - Empty `private_network_uuid`, and the key absent: rc≠0 with a message naming the VPC.
   - Two `databases` entries with the same `cluster_name`: still rc 0.
   - Two entries with different `cluster_name`s: rc≠0.
2. **trust `<cid> <app>`**
   - Rule absent: one `firewalls append <cid> --rule app:<app>` in the log, and `appended=true`.
   - Rule present (`type: app`, `value: <app>`): no append, and `appended=false`.
   - Empty list, both `[]` and `null`: a `::warning::` line, rc 0, no append, and `appended=false`.
   - `FW_LIST_RC=1`: rc≠0, no append, and the output contains `re-run Prod — bring up`.
   - `FW_APPEND_RC=1`: rc≠0 with the same hint.
   - Non-UUID `<cid>` or `<app>`: rc≠0 and no doctl call.
3. **untrust `<cid> <app>`**
   - A match among other rules: one `firewalls remove <cid> --uuid <rule-uuid>`, rc 0.
   - No match: rc 0 and no remove.
   - The match is the only rule: rc≠0, no remove, and `$work/dsum` gains a line naming the rule.
   - `FW_REMOVE_RC=1`: rc≠0, and `$work/dsum` names the rule UUID.
   - Empty list (`[]`/`null`): rc 0 and no remove.
4. **`::error::` gating**: one failing case with `GITHUB_ACTIONS=true` prints `::error::`. The same case
   without it prints no `::error::` but still writes to stderr.

Assert every doctl call against `$work/doctl.log`. Assert that no case logs `firewalls replace` or any
`databases` verb outside `list` / `firewalls list|append|remove`.
The group ends with `echo "dbnet: ok"` (the per-group convention, e.g. `sops-secrets.test.sh:704`).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh dbnet   # RED before Step 2 (script absent); GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```

---

### Step 2 — service: `scripts/do-db-cluster.sh` (lookup / trust / untrust) + CI filter

**Status**: `pending`
**Service**: `scripts/` (deploy pipeline)
**Files**:
- `scripts/do-db-cluster.sh` — create
- `.github/workflows/ci.yml` — modify (`sops` path filter, `:86-96`: add `- 'scripts/do-db-cluster.sh'`)

**Reviewers**: Platform Lead — single helper for three workflows, fail-closed lookup; Security — firewall writes limited to the app's own rule, never empties the list

**Codebase Evidence**:
- Bash conventions: `#!/usr/bin/env bash`, bash 3.2 compatible (root `CLAUDE.md` § macOS), `shfmt -i 2` (`ci.yml:668`).
- Firewall verbs: `scripts/db-connect.sh:82-86,95`. Upstream JSON/flags: § Execution Summary finding 1.
- Exactly-one pattern: `deploy.yml:50-56`. Error style `::error::` + stderr: `deploy.yml:53-54`; renderer `do-render-app-spec.py:126-127`.
- `sops` filter today: `ci.yml:86-96` (lists `scripts/do-render-app-spec.py`, `scripts/sops-secrets.test.sh`, `deploy*.yml`, `prod-up.yml`, `.do/**`).
- Existing `mikefarah` check form: `sops-secrets.test.sh:19`.

**TDD**: `red-green required` (covered by Step 1)

**Covers**: — (covered by Step 1)

**Instructions**:
Create `scripts/do-db-cluster.sh` per design § `scripts/do-db-cluster.sh`, with `set -euo pipefail`.

Header comment: at most 2 lines stating the constraints. Say that prod-down needs only `cluster_id` yet
`lookup` requires a VPC, which prod-down's `continue-on-error` plus its summary step cover.

Helpers:
- `die`: prints `::error::<msg>` to stdout only when `GITHUB_ACTIONS` is set, always prints `<msg>` to
  stderr, then exits 1.
- `out k v`: prints `k=v` to stdout, and also appends it to `$GITHUB_OUTPUT` when that is set.
- `summary`: appends to `$GITHUB_STEP_SUMMARY` when set.
- `check_ids`: one lowercase 8-4-4-4-12 UUID regex, the same form as the renderer's in Step 4.

Tool guard: require `jq`, and require mikefarah yq via `case "$(yq --version 2>&1)" in *mikefarah*) ;; *) die …`.

Subcommands:
- **`lookup`** (env `SPEC`):
  1. Get `name` from `yq e '[.databases[].cluster_name | select(. != null)] | unique'`. It must have
     length 1, otherwise die.
  2. Run `doctl databases list -o json | jq --arg n "$name" '[(. // [])[] | select(.name == $n)]'`. It must
     have length 1, otherwise die with `expected exactly 1 database cluster named $name, found N`.
  3. `check_ids` on `.id` and `.private_network_uuid`. A `null`/empty value dies and names the VPC.
  4. `out cluster_id …` and `out vpc_id …`.
- **`trust <cid> <app>`**:
  1. `check_ids` both arguments.
  2. List the rules once with `doctl databases firewalls list "$cid" -o json`. On failure, die with
     `… re-run Prod — bring up`.
  3. Read the list through `(. // [])`. If it is empty, print
     `::warning::cluster has no trusted sources (open to all); not restricting it`, then `out appended false`, rc 0.
  4. If a rule with `.type == "app" and .value == $app` exists, `out appended false`.
  5. Otherwise run `doctl databases firewalls append "$cid" --rule "app:$app"`. On failure, die with the
     same hint. Then `out appended true`.
- **`untrust <cid> <app>`**:
  1. `check_ids` both arguments, then list the rules once and read them through `(. // [])`.
  2. Collect the UUIDs of rules with `type == app` and `value == $app`. If there are none, rc 0.
  3. If removing them would empty the list, write a `summary` line naming the rule(s), then die.
  4. Otherwise run `doctl databases firewalls remove "$cid" --uuid "$u"` for each. On a failure, write a
     `summary` line naming that UUID, then die.

Never call `firewalls replace` or any `databases` write verb other than `firewalls append` and `firewalls remove`.

Add `- 'scripts/do-db-cluster.sh'` to the `sops` filter list in `ci.yml` (after `'scripts/do-render-app-spec.py'`, `:88`).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh dbnet   # GREEN
shellcheck scripts/do-db-cluster.sh scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/do-db-cluster.sh scripts/sops-secrets.test.sh
grep -n "scripts/do-db-cluster.sh" .github/workflows/ci.yml
```

---

### Step 3 — test: render VPC cases (AC-1/AC-2, leak guard) + deploy/prod-up render wiring

**Status**: `pending`
**Service**: `scripts/` + `.github/workflows` (deploy pipeline)
**Files**:
- `scripts/sops-secrets.test.sh` — modify (`rnd`, `REVMAP`, `group_render`, `group_deploy`, `group_produp`)

**Reviewers**: Platform Lead — DO spec parity across both specs and both render sites; Security — leftover-guard never echoes rendered values

**Codebase Evidence**:
- `rnd` fixed arg list: `sops-secrets.test.sh:425-432`.
- REVMAP: argv slice `sys.argv[1:6]` at `:442`, baseline replace at `:443`. Its only call site is `:508`. The only lines it allows to differ match `^(\s+value: )(YOUR_(?:DEV|PROD)_…)` (`:458`).
- `group_render` (`:493-576`): `need` at `:494`; no-`YOUR_` assert at `:513`; GITHUB_OUTPUT key pin at `:518`; AC-10 no-`--out` pattern at `:539-544`; name-mismatch case at `:571-573`.
- `group_deploy` (`:619-680`): step extraction by id via `yq e '.jobs.deploy.steps[] | select(.id == …)'` at `:636`.
- `group_produp` (`:685-705`): `uses:` pin at `:692-693` (unchanged by this feature); render argument greps at `:695-697`.
- Render call sites: `deploy.yml:62-85` (id `render`), `prod-up.yml:47-71` (id `render`, gated `if: steps.check.outputs.app_id == ''`).
- Renderer error path: `do-render-app-spec.py:125-128` (`::error::` + stderr, exit 1). Leftover check today: `:100-102` (echoes token names).

**TDD**: `red-green required`. RED today: the renderer rejects `--vpc-id` (argparse, rc 2), the specs have no `.vpc`, and the workflows have no `db` step.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. **`rnd`**: pass `--vpc-id "${RND_VPC-$FIXTURE_VPC}"`. The empty case uses a one-shot `RND_VPC= rnd …`
   (design § Tests). `FIXTURE_VPC` comes from Step 1.
2. **REVMAP** (A7):
   - The argv slice becomes `sys.argv[1:7]`, with the 6th value being the VPC.
   - `base` additionally does `.replace("YOUR_VPC_ID", vpc)`.
   - The single call site `:508` passes `"$FIXTURE_VPC"` as the 6th argument.
   - Add `yq` to `group_render`'s `need` at `:494`.
3. **AC-1**: in the both-specs loop (`:504-528`), after the render, assert
   `[ "$(yq e '.vpc.id' "$work/r.yaml")" = "$FIXTURE_VPC" ]` for each spec.
4. **AC-2**: for each case, assert rc 1, `YOUR_VPC_ID` in `$work/err` and in the `::error::` line of
   `$work/out`, that `--out` is absent, and that `$work/out` has no `::add-mask::` line. The cases:
   - empty: `RND_VPC=`;
   - non-UUID: `RND_VPC=not-a-uuid`, plus an uppercase UUID;
   - block deleted: a `$work` copy of `.do/app.dev.yaml` with the `vpc:` and `id:` lines removed;
   - block doubled: a `$work` copy with a second `YOUR_VPC_ID` occurrence.

   Mutated copies live under `$work` only and keep `name: xstockstrat-staging`.
5. **Leak case** (A6): render staging with `LEGACY_SLACK_WEBHOOK_URL=YOUR_PROD_LEAKED` plus the required keys.
   - Assert rc 1 and no `--out`.
   - The `^::error::` lines of `$work/out`, plus all of `$work/err`, contain `placeholder-like token(s) remain`
     and `values withheld`, and do **not** contain `YOUR_PROD_LEAKED`.
   - `::add-mask::YOUR_PROD_LEAKED` is allowed.
6. Keep the existing asserts: `:513` no `YOUR_*`, `:518` the GITHUB_OUTPUT keys stay `app_name project_id`,
   and case 5's `YOUR_(DEV|PROD)_` grep.
7. **`group_deploy`**:
   - A step with `id: db` exists.
   - Its index is less than `render`'s, and `render`'s is less than the `doctl apps update` step's.
   - `db` has no `continue-on-error` and no `if`.
   - `db.env.SPEC` == `${{ inputs.app_spec }}`.
   - `db.run` contains `do-db-cluster.sh lookup`.
   - `render.env.VPC_ID` == `${{ steps.db.outputs.vpc_id }}`.
   - `render.run` contains `--vpc-id "$VPC_ID"`.
   - No `${{` appears in `db.run`.
8. **`group_produp`**:
   - A step with `id: db` exists, positioned after `check` and before setup-sops and `render`.
   - It has no `if` and no `continue-on-error`.
   - `db.env.SPEC` == `.do/app.yaml`.
   - `render.env.VPC_ID` == `${{ steps.db.outputs.vpc_id }}`.
   - `render.run` contains `--vpc-id "$VPC_ID"`.
   - The `uses:` pin at `:692-693` stays byte-identical.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh render deploy produp   # RED before Step 4; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```

---

### Step 4 — service: atomic VPC placeholder — specs + renderer + deploy.yml/prod-up.yml render wiring

**Status**: `pending`
**Service**: `scripts/` + `.do/` + `.github/workflows` (deploy pipeline)
**Files**:
- `.do/app.yaml` — modify (after `region: nyc`, `:6`)
- `.do/app.dev.yaml` — modify (after `region: nyc`, `:6`)
- `scripts/do-render-app-spec.py` — modify
- `.github/workflows/deploy.yml` — modify (new `db` step; render `--vpc-id`)
- `.github/workflows/prod-up.yml` — modify (new `db` step; render `--vpc-id`)

**Reviewers**: Platform Lead — every render site fills the new placeholder in one commit; Security — fail-closed before secrets resolve, no value echo

**Codebase Evidence**:
- `.do/app.yaml:5-6` / `.do/app.dev.yaml:5-6`: `name:` then `region: nyc`. No `vpc` exists anywhere in `.do`, `.github/workflows` or `scripts` (grep `vpc|private_network`: no hits).
- Renderer:
  - `do-render-app-spec.py:76-80`: name check.
  - `:81-83`: literal replace chain `YOUR_GITHUB_ORG` / `YOUR_IMAGE_TAG`.
  - `:84`: `sops_secrets.resolve`.
  - `:99-102`: substitution and the leftover check, which today echoes the token names via `PLACEHOLDER` (`:21`, DEV/PROD only).
  - `:114-121`: argparse.
  - `:125-128`: `SecretError` exit path.
- `deploy.yml`: setup-sops at `:60`, render at `:62-85`, update at `:90`.
- `prod-up.yml`: check at `:34-42`, setup-sops at `:44-45` (gated), render at `:47-71` (gated).
- `app-spec vpc: {id}`: `godo/apps.gen.go:663,726-729` (Execution Summary finding 1).

**TDD**: `red-green required` (covered by Step 3)

**Covers**: — (covered by Step 3)

**Instructions**:
1. **Specs.** In both files, insert after `region: nyc`:
   ```yaml
   vpc:
     id: YOUR_VPC_ID
   ```
   Mention the token nowhere else in either spec, including comments.
2. **Renderer** (design § Renderer):
   - Add `p.add_argument("--vpc-id", required=True)`.
   - In `render()`, after the name check (`:77-80`) and before `sops_secrets.resolve` (`:84`):
     - require `args.vpc_id` to fully match `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
     - require `text.count("YOUR_VPC_ID") == 1`.
     - Either failure raises `sops_secrets.SecretError` with a message naming `YOUR_VPC_ID`. Do not include
       the given value, so no mask is needed. Nothing is written to `--out`.
   - Before the literal chain, capture `names = set(re.findall(r"YOUR_[A-Z0-9_]+", text))`.
   - Add `.replace("YOUR_VPC_ID", args.vpc_id)` to the chain at `:81-83`.
   - Replace the leftover check at `:100-102`:
     - report `sorted(n for n in names if n in text)` by name, as today;
     - otherwise, if any `YOUR_[A-Z0-9_]+` remains, raise
       `f"{count} placeholder-like token(s) remain (values withheld)"`;
     - never include rendered text in the message.
   - Update the module docstring (`:2-5`) only if it lists the arguments. It does not today, so leave it.
3. **deploy.yml**: insert between `- uses: ./.github/actions/setup-sops` (`:60`) and the render step:
   ```yaml
   - name: Look up the database cluster (VPC + cluster ID)
     id: db
     env:
       SPEC: ${{ inputs.app_spec }}
     run: bash scripts/do-db-cluster.sh lookup
   ```
   Then in the render step, add `VPC_ID: ${{ steps.db.outputs.vpc_id }}` to `env:` and append
   `--vpc-id "$VPC_ID"` to the folded `run:`. Do not add a `continue-on-error`, and make no firewall change
   in deploy.yml (design § Rejected: trust in deploy.yml).
4. **prod-up.yml**: insert the same step between `check` (`:34-42`) and setup-sops (`:44`), with `SPEC: .do/app.yaml`,
   **no `if`** and no `continue-on-error`. The render step gains the same `VPC_ID` env and `--vpc-id "$VPC_ID"`,
   and stays gated. Leave check, create, wait and report alone; Step 6 changes them.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh dbnet render deploy produp ac24
ruff check scripts/do-render-app-spec.py && ruff format --check scripts/do-render-app-spec.py
grep -c 'YOUR_VPC_ID' .do/app.yaml .do/app.dev.yaml   # 1 each
```

---

### Step 5 — test: prod-up check / trust / wait / report (wiring + stub-run wait loop)

**Status**: `pending`
**Service**: `.github/workflows` (deploy pipeline)
**Files**:
- `scripts/sops-secrets.test.sh` — modify (`group_produp`)

**Reviewers**: Platform Lead — prod-up idempotence on an existing app, one gated redeploy; Security — firewall write only via `trust`

**Codebase Evidence**:
- prod-up today:
  - check (`:34-42`) accepts any number of apps and says "nothing to do";
  - wait (`:93-109`) and report (`:111-116`) are gated on `steps.create.outputs.app_id != ''`;
  - both inline `${{ steps.create.outputs.app_id }}` (`:96`, `:114`), which design A2 forbids in extracted runs;
  - wait polls `list-deployments … | head -1` and `get-deployment … --format Phase` (`:98-99`);
  - the only `always()` step is `rm -f` (`:118-120`).
- Extraction + stub-run harness: `sops-secrets.test.sh:636-663`. The `always()` pin: `:699-700`.
- Phases and `create-deployment`: § Execution Summary finding 1.

**TDD**: `red-green required`. RED: there are no `trust` step, no `env` on wait/report, and no redeploy branch yet.

**Covers**: `AC-3`

**Instructions**:
Extend `group_produp`. These are static wiring asserts with `yq`, selecting by step `id`.

- **Step order**: `check` < `db` < setup-sops < `render` < `create` < assign < `trust` < `wait` < `report` < `rm -f`.
- **`trust`**:
  - `env.APP_ID` == `${{ steps.create.outputs.app_id || steps.check.outputs.app_id }}`;
  - `env.CLUSTER_ID` == `${{ steps.db.outputs.cluster_id }}`;
  - its run contains `do-db-cluster.sh trust "$CLUSTER_ID" "$APP_ID"`;
  - it has no `continue-on-error`.
- **`wait` and `report`**:
  - `if` == `steps.create.outputs.app_id != '' || steps.trust.outputs.appended == 'true'`;
  - report `env.APP_ID` uses the same expression as trust (A1);
  - wait env has `APP_ID` (same expression), `CREATED: ${{ steps.create.outputs.app_id }}` and
    `APPENDED: ${{ steps.trust.outputs.appended }}`;
  - wait has no `shell:` key;
  - no `${{` appears in either `run:` (A2).
- **check**: extract the run and execute it against a stub `doctl apps list` printing 0, 1 or 2
  `xstockstrat-production` rows.
  - 0 → `app_id=` empty, rc 0.
  - 1 → `app_id=<id>` and the A9 message `already exists — ensuring it is a trusted source; redeploys only if the rule was just added and the latest deployment failed`.
  - 2 → rc≠0 and `expected at most 1`.
- **wait loop**: extract `wait.run` and execute it via `env -i PATH="$work/stub:$PATH" HOME="$HOME" APP_ID=… CREATED=… APPENDED=… bash -e`.
  - The stub `sleep` is a no-op.
  - The stub `doctl` logs its argv and serves scripted per-call answers for `apps list-deployments`,
    `apps get-deployment` and `apps create-deployment`.
  - Cases:
    - ACTIVE → rc 0.
    - ERROR→ACTIVE with `CREATED` set → exactly 1 `create-deployment`, rc 0.
    - ERROR→ACTIVE with `APPENDED=true` → the same.
    - ERROR with neither set → rc 1 and 0 creates.
    - ERROR→ERROR → rc 1 after 1 create.
    - SUPERSEDED→(newest) ACTIVE → rc 0.
    - CANCELED → rc 1.
    - `create-deployment` rc≠0 → rc≠0.
    - `create-deployment` prints empty → rc 1.
    - Empty list ×2, then present → rc 0.
    - Timeout: always non-terminal for 60 polls → `::warning::` and rc 0.
- Keep every existing produp pin, including the `uses:` list and the single `always()` `rm -f`.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh produp   # RED before Step 6; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```

---

### Step 6 — service: prod-up check / trust / wait (one gated redeploy) / report

**Status**: `pending`
**Service**: `.github/workflows` (deploy pipeline)
**Files**:
- `.github/workflows/prod-up.yml` — modify

**Reviewers**: Platform Lead — existing-app no-op preserved unless the rule changes; Security — firewall append only for the resolved prod app ID

**Codebase Evidence**:
- `prod-up.yml`:
  - check: `:34-42`;
  - create: `:73-79` (output `app_id`);
  - assign: `:81-91`;
  - wait: `:93-109`, polling commands at `:98-99`;
  - report: `:111-116`;
  - `rm -f` with `if: always()`: `:118-120`.
- The header comment at `:3-9` describes recreation.
- deploy.yml's wait (`:105-120`) exits 1 on timeout. prod-up deliberately warns and returns 0 instead (design § Rejected: shared wait-loop script).

**TDD**: `red-green required` (covered by Step 5)

**Covers**: — (covered by Step 5)

**Instructions**:
Implement design § prod-up.yml steps 1–9 with amendments A1, A2, A3 and A9:
1. **check**: count the `xstockstrat-production` rows.
   - More than 1 → `::error::expected at most 1 app named xstockstrat-production, found N` and exit 1.
   - Exactly 1 → print the A9 message.
   - Always write `app_id=` to `$GITHUB_OUTPUT`.
2. **trust**: add it after assign, with
   `env: { APP_ID: ${{ steps.create.outputs.app_id || steps.check.outputs.app_id }}, CLUSTER_ID: ${{ steps.db.outputs.cluster_id }} }`,
   `id: trust` and `run: bash scripts/do-db-cluster.sh trust "$CLUSTER_ID" "$APP_ID"`. It has no `if` and no
   `continue-on-error`.
3. **wait**:
   - `if: steps.create.outputs.app_id != '' || steps.trust.outputs.appended == 'true'`.
   - `env`: `APP_ID` (same expression), `CREATED`, `APPENDED`.
   - No `${{` inside `run:`, and no `shell:` key.
   - The loop runs `for i in $(seq 1 60)`:
     1. Get `DEPLOY_ID` from `list-deployments … --format ID --no-header | head -1`. While it is empty,
        tolerate up to 4 polls.
     2. Read `PHASE` with `get-deployment`, then act on it:
        - `ACTIVE` → exit 0.
        - `ERROR` → if `{CREATED non-empty or APPENDED == true}` and no redeploy has been done yet, run
          `new=$(doctl apps create-deployment "$APP_ID" --format ID --no-header)`. Empty output → exit 1.
          Otherwise set `DEPLOY_ID=$new` and keep polling that deployment. In every other case, exit 1.
        - `CANCELED` → exit 1.
        - `SUPERSEDED` → re-list and follow the newest deployment.
     3. `sleep 15`.
   - After the loop: `echo "::warning::…"` and exit 0.
4. **report**: the same `if` as wait, `env: APP_ID` (A1), and no `${{` in `run:`.
5. Keep `rm -f` as the only `always()` step, unchanged. Add no new `uses:`.
6. Update the header comment (`:3-9`) to say that bring-up also makes the app a trusted source of cluster
   `xstockstrat`. Keep it to 2 lines added at most.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh produp render
yq e 'true' .github/workflows/prod-up.yml >/dev/null
```

---

### Step 7 — test: `proddown` group (pins, step order, continue-on-error, forbidden verbs)

**Status**: `pending`
**Service**: `.github/workflows` (deploy pipeline)
**Files**:
- `scripts/sops-secrets.test.sh` — modify (new `group_proddown`; register `proddown` in the default list at `:787`)

**Reviewers**: Platform Lead — teardown order (delete before untrust), no-op when already down; Security — cluster never modified beyond the app's own rule

**Codebase Evidence**:
- `prod-down.yml:19-38` today: one job `down`, `if: ${{ inputs.confirm == 'destroy-prod' }}` (`:21`), unpinned `digitalocean/action-doctl@v2` (`:24`), no checkout and no `permissions`. It deletes by name with `awk` (`:30-37`).
- Pins: `CHECKOUT_PIN` / `DOCTL_PIN` at `sops-secrets.test.sh:682-683`. No static test of `prod-down.yml` exists (recon § Not found).

**TDD**: `red-green required`. RED: there is no checkout, no `db`/`untrust`/summary step, and the doctl pin is wrong.

**Covers**: `AC-4`

**Instructions**:
Add `group_proddown`, which calls `need yq python3` and checks that `.github/workflows/prod-down.yml` parses.
Register `proddown` in the default list at `:787`. Assert:
- **Pins and permissions**:
  - `[.jobs.down.steps[].uses | select(. != null)] | join(" ")` == `"$CHECKOUT_PIN $DOCTL_PIN"`;
  - `.jobs.down.permissions.contents` == `read`;
  - `.jobs.down.if` == `${{ inputs.confirm == 'destroy-prod' }}`.
- **Step order by id**: `find` < `delete` < `db` < `untrust` < the summary step.
- **`find`**: extract its run and execute it against a stub `doctl apps list`.
  - 0 rows → rc 0, `app_id=` empty, and the output contains `already down`.
  - 1 row → `app_id=<id>`.
  - 2 rows → rc≠0.
- **`delete`**: `if` == `steps.find.outputs.app_id != ''`, no `continue-on-error`, and its run contains `doctl apps delete "$APP_ID" --force`.
- **`db`**: `continue-on-error: true`, `if` == `steps.find.outputs.app_id != ''`, `env.SPEC` == `.do/app.yaml`,
  and its run contains `do-db-cluster.sh lookup`.
- **`untrust`**:
  - `continue-on-error: true`;
  - `if` == `steps.find.outputs.app_id != '' && steps.db.outputs.cluster_id != ''`;
  - `env.APP_ID` == `${{ steps.find.outputs.app_id }}`;
  - `env.CLUSTER_ID` == `${{ steps.db.outputs.cluster_id }}`;
  - its run contains `do-db-cluster.sh untrust "$CLUSTER_ID" "$APP_ID"`.
- **Summary step**:
  - `if` == `always() && steps.find.outputs.app_id != '' && steps.delete.outcome == 'success' && steps.untrust.outcome != 'success'`;
  - it writes to `$GITHUB_STEP_SUMMARY`;
  - its text has a "cluster lookup failed" branch for when `steps.db.outcome != 'success'`.
- **No `${{` in any extracted `run:`** of the five steps.
- **Forbidden verbs**: `grep -nE 'doctl databases (delete|resize|migrate|db delete|pool delete|user delete)|firewalls (append|replace)' .github/workflows/prod-down.yml` finds nothing.
- **Wording**: the header and the echo contain `cluster data untouched`.
- The group ends with `echo "proddown: ok"`.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh proddown   # RED before Step 8; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```

---

### Step 8 — service: prod-down delete → best-effort untrust + CI filter

**Status**: `pending`
**Service**: `.github/workflows` (deploy pipeline)
**Files**:
- `.github/workflows/prod-down.yml` — modify (rewrite the `down` job)
- `.github/workflows/ci.yml` — modify (`sops` path filter: add `- '.github/workflows/prod-down.yml'`)

**Reviewers**: Platform Lead — a red teardown never strands a live app without DB access; Security — only the app's own trusted-source rule is removed

**Codebase Evidence**:
- `prod-down.yml:1-38` (current job). The pinned action lines to copy are at `prod-up.yml:28,30`.
- `sops` filter at `ci.yml:86-96`; `prod-up.yml` is listed at `:92`.
- Order rationale: design § Rejected Alternatives (untrust before delete; hard-fail untrust).

**TDD**: `red-green required` (covered by Step 7)

**Covers**: — (covered by Step 7)

**Instructions**:
Implement design § prod-down.yml. Keep the `on:` block, `concurrency: prod-lifecycle` and the job `if`.
Add `permissions: contents: read`.

Steps:
1. `- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1`.
2. `- uses: digitalocean/action-doctl@3cb3953159719656269e044e0e24ca16dd2a690f  # v2.5.2` with the existing `token:`.
3. **`id: find`**: the same `awk` lookup as today.
   - More than 1 row → `::error::expected at most 1 …` and exit 1.
   - 0 rows → echo `No xstockstrat-production app found — already down.`
   - Always write `app_id=` to `$GITHUB_OUTPUT`.
4. **`id: delete`**, `if: steps.find.outputs.app_id != ''`, `env: APP_ID: ${{ steps.find.outputs.app_id }}`.
   Run `doctl apps delete "$APP_ID" --force`, then echo
   `Done. Cluster data untouched; only the app's trusted-source rule is removed next.`
5. **`id: db`**, `continue-on-error: true`, `if: steps.find.outputs.app_id != ''`, `env: SPEC: .do/app.yaml`,
   `run: bash scripts/do-db-cluster.sh lookup`.
6. **`id: untrust`**, `continue-on-error: true`, `if: steps.find.outputs.app_id != '' && steps.db.outputs.cluster_id != ''`,
   env `APP_ID` and `CLUSTER_ID`, `run: bash scripts/do-db-cluster.sh untrust "$CLUSTER_ID" "$APP_ID"`.
7. **Summary**: `if: always() && steps.find.outputs.app_id != '' && steps.delete.outcome == 'success' && steps.untrust.outcome != 'success'`,
   with env `APP_ID`, `CLUSTER_ID` and `DB_OUTCOME: ${{ steps.db.outcome }}`.
   - It appends a remediation line to `$GITHUB_STEP_SUMMARY`: remove the `app:$APP_ID` trusted source of
     cluster `xstockstrat`.
   - When `DB_OUTCOME != success`, the text says `cluster lookup failed` and never prints an empty cluster ID.

Rewrite the header comment (`:3-8`): it deletes the app and then removes only the app's trusted-source rule,
and cluster data is untouched. Keep it within the existing line budget.

Add `- '.github/workflows/prod-down.yml'` to the `sops` filter after `'.github/workflows/prod-up.yml'` (`ci.yml:92`).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh proddown dbnet
yq e 'true' .github/workflows/prod-down.yml >/dev/null
grep -n "prod-down.yml" .github/workflows/ci.yml
```

---

### Step 9 — docs: DO setup guide, digitalocean-setup skill, prod-lifecycle runbook + context teardown

**Status**: `pending`
**Service**: `docs/setup/`, `docs/runbooks/`, `.claude/skills/digitalocean-setup/`
**Files**:
- `docs/setup/digitalocean.md` — modify
- `.claude/skills/digitalocean-setup/SKILL.md` — modify
- `docs/runbooks/infra-cost-reduction.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `digitalocean.md`:
  - `:227-231`: Step 5 manual `sed` of `YOUR_GITHUB_ORG` and `doctl apps create`.
  - `:268-272`: Step 6, the same.
  - `:451`: "`doctl apps update` will wire them".
  - `:464-467`: Step 8 raw `doctl apps update $DO_*_APP_ID --spec .do/app*.yaml`, which would send an unrendered `YOUR_VPC_ID`.
  - `:476`: "Component name must be `db` (… `databases: - name: db`)". The spec uses `name: xstockstrat` (`.do/app.yaml:688`).
  - `:489`: the token row.
  - `:594`: Troubleshooting `${db.DATABASE_URL}`.
- `SKILL.md`:
  - `:232`: P0b "contains a `db` component".
  - `:361-366`: P4 `sed … | doctl apps create`.
  - `:442-447`: P5, the same.
  - `:506-510`: P6 python render piped into `doctl apps update`.
  - `:557-575`: P7 "doctl cannot attach a managed database", plus `${db.DATABASE_URL}` and `db`.
- `infra-cost-reduction.md`:
  - `:43-44`: the lifecycle rows.
  - `:46-47`: "Data safety".
  - `:64-67`: "First bring-up needs validation".
- Teardown rule: root `CLAUDE.md` § Teardown; `.agents/context-forge.json` (`scrubberExtraTargets`: `README.md`, `docs/patterns/ui-ux-governance.md`, neither touched).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **`docs/setup/digitalocean.md`**
   - **Steps 5 and 6**: before the `sed`, look up the VPC ID:
     `vpc_id=$(doctl databases list -o json | jq -r '.[] | select(.name=="xstockstrat") | .private_network_uuid')`.
     Add `-e "s|YOUR_VPC_ID|$vpc_id|g"`. Create with `--format ID --no-header`, capture the ID, then run
     `doctl databases firewalls append <cluster-id> --rule app:<app-id>`.
   - **Step 8**: drop the raw `doctl apps update` block and point to the deploy workflows (`deploy-dev.yml` /
     `deploy-prod.yml` → `deploy.yml`) and `prod-up.yml`, which render `vpc:` and fail closed.
   - Rename `db` → `xstockstrat` at `:476` and at the `:594` heading.
   - **Token row `:489`**: the token needs database read (deploy) and database read+update (prod-up/prod-down).
   - Add one sentence warning that `scripts/db-connect.sh`'s append/remove is a read-modify-write of the
     cluster's rule list, so it must not run concurrently with prod-up/prod-down.
   - All commands must stay macOS-compatible (root `CLAUDE.md` § macOS).
2. **`.claude/skills/digitalocean-setup/SKILL.md`**
   - P4/P5: the same VPC lookup, `-e "s|YOUR_VPC_ID|${VPC_ID}|g"`, then the trust append.
   - P6: replace the render-and-update block with a pointer to the deploy workflows.
   - P7: spec-based. The `databases:` and `vpc:` blocks attach the cluster at create time, so remove the
     "doctl cannot attach" claim. The verify command stays.
   - P0b `:232` and P7: `db` → `xstockstrat`, and `${db.DATABASE_URL}` → `${xstockstrat.DATABASE_URL}`.
3. **`docs/runbooks/infra-cost-reduction.md`**
   - Update the `:43-44` rows. Bring-up also attaches the VPC (via the lookup) and makes the new app a
     trusted source, with one automatic redeploy if the first deployment failed. Teardown deletes the app,
     then removes only that app's trusted-source rule.
   - "Data safety": cluster data is untouched, and only the app's rule is removed.
   - The validation caveat now also covers confirming `db-migrator` connects.
   - Add a caveat: an existing prod app picks up `vpc:` only on its next `deploy-prod`.
4. **Context teardown** (root `CLAUDE.md` § Teardown): run
   `/context-forge:context-constitution refresh` scoped to the files touched in Steps 1–9 and fix any grounded
   drift. `docs/patterns/ci-overview.md:23` (the `sops-secrets` row) is the likely candidate, since the suite
   now also covers `do-db-cluster.sh` and prod-down. If the plugin is unavailable, re-read each touched
   context file against the code by hand, and record in the PR body both that the plugin was unavailable and
   the manual reconciliation done.

**Verification**:
```bash
grep -n 'YOUR_VPC_ID' docs/setup/digitalocean.md .claude/skills/digitalocean-setup/SKILL.md   # each manual render site fills it
grep -nE 'databases: - name: db|\$\{db\.DATABASE_URL\}|cannot attach a managed database' docs/setup/digitalocean.md .claude/skills/digitalocean-setup/SKILL.md   # no output
grep -nE 'doctl apps update \$DO_(DEV|PROD)_APP_ID +--spec \.do/' docs/setup/digitalocean.md   # no output
grep -n 'trusted' docs/runbooks/infra-cost-reduction.md
```

---

### Step 10 — test: full-suite regression gate

**Status**: `pending`
**Service**: `scripts/` + `.github/workflows` (deploy pipeline)
**Files**:
- none (verification only; any fix it forces is a deviation against the step that owns the file)

**Reviewers**: Platform Lead — whole deploy-pipeline suite green, PRESERVE rules intact

**Codebase Evidence**:
- Default groups: `sops-secrets.test.sh:787` (with `dbnet` and `proddown` from Steps 1 and 7).
- CI job `sops-secrets`: `ci.yml:921-945` (ruff on the two Python scripts, then the whole suite). `shell-lint`: `ci.yml:651-668`.
- PRESERVE rules (design § Business Rules Touched): `docs/sdd/business-rules/platform.feature`, @feature-286 @AC-8/9/10/11/16/17/21/22/24 (`:923-1013`).

**TDD**: `red-green required`. This is the green run only, because the red runs are captured in Steps 1/3/5/7.

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions**:
Run the full suite with no group argument, so every default group runs. Then run ruff on both renderer
scripts and shellcheck + shfmt over `scripts/*.sh`, exactly as CI does. Confirm the counts show the cases
actually executed (fails.md 2026-07-29): each group prints its `<group>: ok` line, including `dbnet: ok`
and `proddown: ok`. Do not edit files here. A failure is fixed through a Deviation Log entry against the
step that owns the file.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh 2>&1 | tee /dev/stderr | grep -c ': ok$'   # 12 groups
ruff check scripts/sops_secrets.py scripts/do-render-app-spec.py && ruff format --check scripts/sops_secrets.py scripts/do-render-app-spec.py
shellcheck scripts/*.sh .claude/hooks/*.sh && shfmt -d -i 2 scripts/*.sh .claude/hooks/*.sh
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
