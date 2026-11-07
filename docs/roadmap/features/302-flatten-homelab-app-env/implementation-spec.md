# Implementation Spec: flatten-homelab-app-env

**Status**: `in-progress`
**Created**: 2026-11-07
**Feature**: `docs/roadmap/features/302-flatten-homelab-app-env/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/flatten-homelab-app-env` (not created on origin; per `context.md` 2026-11-07 the work stays on the session branch `ccr-9bdbcd90-kgj5ev`. `/sdd-execute` must resolve the PR base before the first write.)

**Tree**: `ccr-9bdbcd90-kgj5ev@42e1463 ≡ origin/ccr-9bdbcd90-kgj5ev` (`origin/main-dev@ab8a9ce` is an ancestor; no tracked changes). Every `path:line` below was read on this tree.

---

## Execution Summary

Deploy tooling only (`scripts/`, `.github/workflows/`, `docs/`): no runtime service, proto, config key or migration, so the Consumer Surface is **None** (C-14: a stated decision, not an omission) and no per-service coverage threshold applies. The `KEYS` table in `scripts/sops_secrets.py` stays the only layout source; `keys_for(target)` becomes the single merged view (design.md, Chosen Approach).

Steps 1-4 are **one atomic unit** (F-05, `step-constraints.md` §C). The tests call the new `keys_for` shape, the renderer unpacks it, and `check_legacy` compares the workflow to `KEYS`, so no member passes its own Verification without the others. They land as ONE commit with one red-green cycle: Step 1 runs RED against the old tree, Steps 2-4 turn it GREEN. Step 5 (docs) follows. Promotion (AC-12) is not an implementation step.

### Scenario Coverage (C-15)

| Scenario | Covered by | Note |
|---|---|---|
| AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-11 | Step 1 (`group_resolve` cases 7, 9, 10, 11) | homelab CLI through the patched wrapper |
| AC-8 | Step 1 (`group_homelab`, `expected_legacy`/`check_legacy`); made GREEN by Step 4 | the workflow-consistency check |
| AC-9 | Step 1 (`group_resolve` case 8) | resolver output through the real release script and `docker compose config`; `scripts/homelab-render.test.sh` stays unchanged as the release-env regression |
| AC-10 | Step 5 | the scenario is itself a grep over a docs file; Step 5 carries the `**Covers**` line (docs step, deliberate departure from "omit on non-test") |
| AC-13, AC-15, AC-16 | Step 1 (new cases 14, 15, 16) | test-side `T_KEYS_EXTRA` patch of `s.KEYS` (AC-15 uses the real `KEYS`) |
| AC-14 | Step 1 (case 7) | no override: `JWT_SECRET: sops`, value from `common` |
| AC-12 | **Promotion time, no step** | verified once at promotion and excluded from promotion itself (see `acceptance.feature`); the C-16 promotion (integration PR / `/promote`) writes the `@feature-302` scenarios and the supersession comment. This PR never touches `docs/sdd/business-rules/platform.feature` (FR-6). |

Design test cases with no dedicated `@AC-*` (FR-7 `required` OR, empty override falls through, `differs from legacy` label inside the parentheses, the table check) are traced to **FR-7** in Step 1 (variants inside case 14, and cases 17-18). The first-appearance order of an overridden name is asserted by case 14's "before `BROKER_ACCOUNTS_ENCRYPTION_KEY`" check. If review wants a scenario each, that is a product-spec change (append AC-17+; IDs are append-only, C-15), not something to fold in here.

## Step Dependencies

- Steps 1, 2, 3, 4 land together: Step 1 references `keys_for`'s new 3-tuple shape and the flat `KEYS` rows that Step 2 creates (§C trigger "adds a test that references a symbol a later step creates"); Step 2 changes `keys_for`'s return shape, which Step 3 unpacks (§C "changes a return shape"); Step 4's `LEGACY_*` lines are what Step 1's `check_legacy` derives from the Step 2 `KEYS`. Unit size 4 (the cap), one surface (deploy tooling).
- Step 5 requires Step 4: the runbook's legacy-secret removal list names the `DB_PASSWORD`/`APP_URL`/`SEED_USER_ID` fallback secrets that Step 4 starts reading.
- Test-pairing (C-08): Step 1 is the paired `test` step for Steps 2-4. The scripts are not a service with a coverage threshold; the CI gate is the `sops-secrets` job (`.github/workflows/ci.yml:975-999`), which runs ruff on the two scripts and then all of `scripts/sops-secrets.test.sh`.
- Preflight, not a step (design Open Risks, product-spec Open Questions): before the first homelab deploy `gh secret list --env staging` and `gh secret list --env production` must not list `APP_ENV` (operator-asserted, unverified). Step 5 writes it into the runbook.

---

### Step 1 — test: rewrite the homelab resolve cases on flat keys and add the precedence cases

**Status**: `done`
**Service**: `scripts/` (deploy tooling)
**Files**:
- `scripts/sops-secrets.test.sh` — modify

**Reviewers**: Security — values never printed, masks first, fail-closed on a missing required key; Platform Lead — `KEYS` table, workflow `LEGACY_*` lines and the tests stay in step

**Codebase Evidence**:
- Confirmed via: `Read scripts/sops-secrets.test.sh` on the verified tree. Harness: `LIB` `:82-87` (`s.resolve(...)` under `python3 -c`), `lib` `:90-96`, `cli` `:99-106` (runs `python3 scripts/sops_secrets.py resolve ... --github-env "$work/ghenv"`), helpers `val` `:108`, `src` `:109` (`sed -n "s/^- $1: //p" "$work/sum"`), `ghenv_get` `:111-115`, `only_masked` `:117-120`, `masks_first` `:121-123`, `do_legacy` `:125-129`.
- Cases to rewrite in `group_resolve`: 7 `:194-208` (builds `homelab:{...,app_env:$app}` at `:198-202`), 8 `:210-231` (release script + compose; the `app_env lines must precede the common tail` awk at `:213-215`), 9 `:233-242` (AC-23 `must not contain common key`), 10 `:244-252` (legacy `LEGACY_APP_ENV` blob), 11 `:254-265` (`1BAD` and `app_env` refusals). Cases 12-13 `:267-282` are untouched and `echo "resolve: ok"` stays last.
- `expected_legacy` `:609-631`: `ns_of = {n: ns for ns, n, _, _ in s.KEYS}` `:616`; the `APP_ENV` reverse-map `:620`; the homelab branch `:623-624` already yields `secrets.<K>` / `vars.TS_AUTHKEY_EXPIRES`. `check_legacy` `:633-639`, `COMMON_RE` `:640`, `no_unprefixed` `:646-648`, `group_homelab` `:954-973` (`check_legacy` at `:960`, `no_unprefixed` at `:962`). `group_build` case 1 `BENV` at `:323` (`APP_ENV=APP_URL=tskey-x`).
- Existing message text the new cases pin (read from the shipped code, not memory; ledger trap `sops-secrets-migration`, fails.md 2026-11-04): missing key `scripts/sops_secrets.py:184-185` (`{name} is in neither SOPS nor the GitHub secrets`); quote/newline `:193` (`{key}: value contains a quote or newline, which the homelab .env cannot hold`); non-string leaf `:133` (`{ns}.{name} must be a string`); heredoc delimiter `:222` (`{name}: value contains the reserved heredoc delimiter`, today only in `write_github_env`).
- Compose consumers for AC-9: `deploy/homelab/compose.yml:12` (`DB_PASSWORD` in `DATABASE_URL`), `:32`/`:37` (`db-migrator` `SEED_USER_ID`), `:273` (`APP_URL`).

**Lands with**: `Step 2, Step 3, Step 4`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11, AC-13, AC-14, AC-15, AC-16`

**Instructions**:
1. **Test-side patch (design: `T_KEYS_EXTRA`).** Add one shared prelude string (used by both `LIB` and a new `CLI` wrapper, so it is written once): it imports `ast`, and when `T_KEYS_EXTRA` is set does `s.KEYS = s.KEYS + tuple(ast.literal_eval(os.environ["T_KEYS_EXTRA"]))`. `sops_secrets.py` never reads `T_KEYS_EXTRA`; `keys_for` reads the module-global `KEYS` at call time, so the patch takes effect (Step 2 requires this). `CLI` = the same imports and prelude + `s.main(sys.argv[1:])`. Change `cli` (`:99-106`) to run `python3 -c "$CLI" resolve --env "$e" --target homelab --github-env "$work/ghenv" --file "$f"`. Callers pass `T_KEYS_EXTRA=...` as an extra env argument (the helpers already forward `"$@"` after `env -i`).
2. **Cases 7-11 on flat keys** (hostile values from the old case 7: `DB_PASSWORD='p$w #1 "x"'`, `JWT_SECRET='j$t'`; fixed `SEED_USER_ID` and `APP_URL`):
   - **7 (AC-1, AC-2, AC-14):** file holds `common.*`, `homelab.TS_AUTHKEY/TS_AUTHKEY_EXPIRES/DEPLOY_SSH_KEY` and the three flat keys; keep the existing `hl` legacy fallbacks. Assert `src DB_PASSWORD`, `src APP_URL`, `src SEED_USER_ID` = `sops`, `src JWT_SECRET` = `sops`, no `app_env` line in `$work/sum`, the six `ghenv_get` heredocs exist, and `ghenv_get APP_ENV` is **byte-equal** to the expected blob: `DB_PASSWORD='...'`, `APP_URL='...'`, `SEED_USER_ID='...'`, then `JWT_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`, `CONFIG_SECRETS_ENCRYPTION_KEY`, one per line, in that order. This replaces the awk ordering check at `:213-215`.
   - **8 (AC-9):** reuse the existing release-script and compose block (`:216-231`) fed by case 7's `APP_ENV`/`MTLS_CA`. Keep the `DB_PASSWORD` literal-in-`DATABASE_URL`, `JWT_SECRET` literal and shared-CA assertions; add `jq -r '.services["db-migrator"].environment.SEED_USER_ID'` equal to the case's `SEED_USER_ID`.
   - **9 (AC-6):** flat keys plus `homelab.app_env` as a map with `APP_URL="https://x.example"`. Assert exit 1, stderr has exactly `homelab.app_env must be a string` (this is `sops_secrets.py:133` once the `:126-131` branch is gone), `[ ! -s "$work/ghenv" ]`, `only_masked https://x.example`.
   - **10 (AC-3, AC-4, AC-5):** (a) no `homelab.DB_PASSWORD`, `LEGACY_DB_PASSWORD=pw-gh` → `src DB_PASSWORD` = `github`, APP_ENV has `DB_PASSWORD='pw-gh'`; (b) no `homelab.APP_URL` and no `LEGACY_APP_URL` → exit 1, stderr has `APP_URL is in neither SOPS nor the GitHub secrets`, `[ ! -s "$work/ghenv" ]`; (c) three flat keys + `LEGACY_APP_ENV=DB_PASSWORD=old` → APP_ENV has `DB_PASSWORD='pw-sops'` and neither `DB_PASSWORD='old'` nor `DB_PASSWORD=old`, no `app_env` summary line.
   - **11 (AC-7, AC-11):** `DB_PASSWORD="pw'x"`, a value with a newline, and `APP_URL="https://x.example/ghadelim_1"`, each with the other two flat keys valid. Assert exit 1, the exact messages `DB_PASSWORD: value contains a quote or newline, which the homelab .env cannot hold` and `APP_URL: value contains the reserved heredoc delimiter`, `[ ! -s "$work/ghenv" ]`, and that `pw'x` is not in stderr.
3. **New cases after 13 (all via `cli`/`lib` with `T_KEYS_EXTRA`; the table-check cases use `cli` because `main()` catches `SecretError`):**
   - **14 (AC-13):** extra `(("homelab","JWT_SECRET",True,("homelab",)),)`; file has `common.JWT_SECRET="jwt-do"`, `homelab.JWT_SECRET="jwt-homelab"`, the three flat keys, no `LEGACY_JWT_SECRET`. Assert `src JWT_SECRET` = `sops (homelab)`; APP_ENV has `JWT_SECRET='jwt-homelab'` exactly once, on a line before `BROKER_ACCOUNTS_ENCRYPTION_KEY=`, and no `jwt-do`. Variants: with `LEGACY_JWT_SECRET=jwt-gh` the label is `sops (homelab; differs from legacy)`; with `homelab.JWT_SECRET=""` the value falls through to `jwt-do` and the label is `sops`.
   - **15 (AC-15):** real `KEYS`; file has `common.SENDGRID_API_KEY="sg-do"` and `homelab.SENDGRID_API_KEY="sg-homelab"`. Assert APP_ENV has `SENDGRID_API_KEY='sg-do'`, `sg-homelab` appears nowhere in `ghenv`, and `only_masked sg-homelab` holds (so the undeclared value is masked too).
   - **16 (AC-16):** `lib staging do` with extra `(("common","PROJECT_X",False,("do",)),("digitalocean","PROJECT_X",False,("do",)))`; file has `common.PROJECT_X="c-val"`, `digitalocean.PROJECT_X="d-val"`, plus the `leg` legacy set. Assert `val PROJECT_X` = `d-val` and `src PROJECT_X` = `sops (digitalocean)`.
   - **17 (FR-7 `required` OR):** extra `(("homelab","JWT_SECRET",False,("homelab",)),)`; no `JWT_SECRET` in file or env → exit 1 with `JWT_SECRET is in neither SOPS nor the GitHub secrets` (an override never weakens a required `common` key).
   - **18 (FR-7 table check):** extra `(("homelab","X1",False,("do",)),)` → exit 1, stderr has `KEYS row homelab.X1: a non-common row must target only its own namespace's target`; extra `(("homelab","DB_PASSWORD",True,("homelab",)),)` → exit 1, stderr has `KEYS declares homelab.DB_PASSWORD twice`. These two strings are new text defined by this feature (Step 2 emits them); they are not in `acceptance.feature`.
4. **`expected_legacy` (`:609-631`)** derives from the merged view: `nss_of = {n: nss for n, _, nss in s.keys_for(target)}` replaces `ns_of`; delete the `:620` reverse-map. Branch order: (i) `target == s.DO and len(nss) > 1` → `raise SystemExit` with a message that a DO override has no `LEGACY_*` convention yet; (ii) `mode == "prod"` as today; (iii) `target == s.HOMELAB and "homelab" in nss` → `vars.TS_AUTHKEY_EXPIRES` or plain `secrets.<K>` (this yields `secrets.DB_PASSWORD`, `secrets.APP_URL`, `secrets.SEED_USER_ID`); (iv) `PROJECT_ID` and the common `format()` forms as today.
5. **`no_unprefixed` (`:646-648`)** ignores `LEGACY_*:` lines (`check_legacy` already pins them exactly), e.g. pipe the grep through `grep -vE '^[0-9]+:[[:space:]]*LEGACY_[A-Z0-9_]+:'`.
6. **`group_homelab` (`:954-973`)** add: (a) `if grep -nE 'LEGACY_APP_ENV|secrets\.APP_ENV' "$wf"; then fail "homelab: AC-8 LEGACY_APP_ENV remains"; fi`; (b) the exclusion-model tripwire: the names of `keys_for(HOMELAB)` that lack `common` and are not in `HOMELAB_EXPORTS`, in order, must equal the reviewed literal `DB_PASSWORD APP_URL SEED_USER_ID` (fail with the diff otherwise, naming the stray key).
7. **`group_build` case 1 (`:323`)** replace `APP_ENV=APP_URL=tskey-x` with `LEGACY_DB_PASSWORD=tskey-x LEGACY_APP_URL=tskey-x LEGACY_SEED_USER_ID=tskey-x` so the real homelab legacy names are proven never seeded (the `tskey-x` greps at `:329` and `:332` stay).
8. C-13 (test data): every literal is single-consumer inside this one file, so inline stays compliant; no fixture home is created.

**Verification**:
RED first, on the tree with only this step applied (each command exits at the first failing assertion, so run the groups separately and keep each output):
```
bash scripts/sops-secrets.test.sh resolve   # expect: ASSERT FAIL: 7: cli failed (...)  (AC-1; old code reads app_env)
bash scripts/sops-secrets.test.sh homelab   # expect: failure in expected_legacy/check_legacy (AC-8; old keys_for returns 2-tuples/LEGACY_APP_ENV)
```
GREEN is the unit's Verification (Step 4). Local prerequisites: `sops`, `age`, `age-keygen`, `docker`, `jq`, `yq` (mikefarah v4), `openssl`. On the verified tree `sops` was not on PATH; install the pinned binaries per `.github/actions/setup-sops/action.yml`, or treat the CI `sops-secrets` job as the authority and say so in the PR.

---

### Step 2 — service: `KEYS` flat rows, merged `keys_for`, label rules, per-key refusals

**Status**: `done`
**Service**: `scripts/` (deploy tooling)
**Files**:
- `scripts/sops_secrets.py` — modify

**Reviewers**: Security — SOPS-first resolution, same-named environment-secret fallback, values never printed, fail-closed; Platform Lead — one `KEYS` table, `keys_for` as the single merged view

**Codebase Evidence**:
- Confirmed via: `Read scripts/sops_secrets.py` (449 lines). `KEYS` `:22-40`, the row to replace `:39` `("homelab", "app_env", True, (HOMELAB,))`; `COMMON` `:42`; `HOMELAB_TAIL` `:44-46`; `HOMELAB_EXPORTS` `:47-53` (kept); `VAR_NAME` `:56`; `LEGACY_COMMON_LINE` `:57-59`; `keys_for` `:66-67` returns `(ns, n, req)`; `legacy_name` `:70-71` (the `app_env` special case); `legacy_names` `:74-76`; `_strings` `:98-99`; `_sha` `:102-104` (dict branch); `decrypt` `:107-134` (map branch `:126-131`, generic `:132-133`); `resolve` `:144-187`; `_quoted` `:190-195`; `homelab_app_env` `:198-216`; `write_github_env` `:219-226`; `cmd_resolve` `:229-240`.
- `cmd_build` reads `KEYS` directly, filters `ns in SEEDED` `:338` and uses `legacy_name(name)` `:340`, `:352`: unchanged, because `SEEDED` is `("common", "digitalocean")` `:243` and `legacy_name` stays a pure prefix.
- Callers of the changed names (grep over the repo, excluding `docs/roadmap` and generated stubs): `keys_for` is used at `scripts/sops_secrets.py:76,151` and `scripts/do-render-app-spec.py:101` only; `HOMELAB_TAIL`/`VAR_NAME`/`LEGACY_COMMON_LINE`/`homelab_app_env` only inside `sops_secrets.py`. `import re` stays needed (`RECIPIENT_LINE` `:244`).
- Existing pattern to reuse: flat required homelab rows `:35-38`; the per-key `LEGACY_<NAME>` fallback in `resolve` `:153`; `mask()` `:88-95`.

**Lands with**: `Step 1, Step 3, Step 4`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **Table.** Replace the `:39` row with three required rows after `DEPLOY_KNOWN_HOSTS`, in this order: `("homelab", "DB_PASSWORD", True, (HOMELAB,))`, `("homelab", "APP_URL", True, (HOMELAB,))`, `("homelab", "SEED_USER_ID", True, (HOMELAB,))`. Ship no override row (FR-7 adds the rule only).
2. **`OWN` and `keys_for`.** Add `OWN = {DO: "digitalocean", HOMELAB: "homelab"}` (target to its own namespace). Rewrite `keys_for(target)` to read `KEYS` at call time and return `[(name, required, namespaces)]`: (a) first validate the unfiltered table: a non-`common` row whose `targets` is not exactly the one target mapped to its namespace raises `SecretError(f"KEYS row {ns}.{name}: a non-common row must target only its own namespace's target")`, and a repeated `(namespace, name)` raises `SecretError(f"KEYS declares {ns}.{name} twice")`; (b) keep rows whose targets include `target`, merge by `name` in first-appearance order (an overridden name keeps its `common` slot), `required` is the OR of the merged rows, `namespaces` lists the target's own namespace first, then `common`.
3. **Legacy names.** `legacy_name(n)` returns `"LEGACY_" + n` (drop the `app_env` special case). `legacy_names(target)` returns `sorted(legacy_name(n) for n, _, _ in keys_for(target))`.
4. **`decrypt`.** Delete the `if name == "app_env" and ns == "homelab"` branch (`:126-131`); the generic `elif not isinstance(value, str)` becomes a plain `if`, so a nested map raises `homelab.app_env must be a string` (AC-6, FR-5). Delete `_strings`; make `_sha` hash a string only.
5. **`resolve`.** Mask every string leaf of the decrypted file (all namespaces, declared or not), then every `LEGACY_<name>` of the merged keys, before any other output (AC-15 needs the undeclared `homelab.SENDGRID_API_KEY` masked). For each merged key: the winner is the first namespace in `namespaces` (own, then `common`; never table order) whose stored value is non-empty, so an empty override falls through; an undeclared `homelab.<common name>` is never in `namespaces`, so it is ignored. If no stored value, fall back to `LEGACY_<name>` (`github`), else `MISSING` for a required key or `absent (optional)`. Label: `sops`, plus a parenthesis only when needed: parts = `[<ns>]` when a non-`common` namespace beat a declared `common` row, and `differs from legacy` when a non-empty legacy value differs; joined with `; `. Examples: `sops`, `sops (differs from legacy)`, `sops (homelab)`, `sops (homelab; differs from legacy)`, `sops (digitalocean)`. Keep the `::warning::` line for a differing value and the `{name}: {label}` summary line.
6. **`_quoted(key, value)`** (drop `label`): first the existing quote/newline refusal with its wording unchanged and the key in the message, then `raise SecretError(f"{key}: value contains the reserved heredoc delimiter")` when `DELIM_PREFIX in value`. Keep `write_github_env`'s own check (`:221-222`) for the direct exports.
7. **`cmd_resolve`.** Build `exports = {n: values[n] for n in HOMELAB_EXPORTS}`; then `APP_ENV` = the merged `keys_for(HOMELAB)` names that are in `values` and not in `HOMELAB_EXPORTS`, names without a `common` namespace first, then those with one, each group in `KEYS` order, each through `_quoted(n, values[n])`, joined by newlines. Build the whole string before calling `write_github_env`, so a refusal leaves the GitHub env file untouched (AC-4, AC-7, AC-11). Delete the `app_env` delimiter loop (`:231-237`).
8. **Delete** `COMMON`, `HOMELAB_TAIL`, `VAR_NAME`, `LEGACY_COMMON_LINE`, `_strings`, `homelab_app_env`, and `_quoted`'s `label` parameter. Comments: constraints only, at most 2 lines (CLAUDE.md rule 7); no mechanism narration.
9. Not touched: `cmd_build`, `_verify`, `_changes`, `SEEDED`, `write_github_env`'s body, `main()`.

**Verification**:
Part of the unit; run after Step 4 (see Step 4). Local check on this file alone: `ruff check scripts/sops_secrets.py && ruff format --check scripts/sops_secrets.py` and `python3 -I -c 'import ast,sys; ast.parse(open("scripts/sops_secrets.py").read())'`. Confirm no leftovers: `grep -nE 'app_env|HOMELAB_TAIL|VAR_NAME|LEGACY_COMMON_LINE|homelab_app_env|_strings' scripts/sops_secrets.py` prints nothing.

---

### Step 3 — service: DO renderer reads the merged `keys_for` shape

**Status**: `done`
**Service**: `scripts/` (deploy tooling)
**Files**:
- `scripts/do-render-app-spec.py` — modify

**Reviewers**: Platform Lead — DigitalOcean behaviour unchanged by the shared `KEYS` view

**Codebase Evidence**:
- Confirmed via: `Read scripts/do-render-app-spec.py:98-113`: `values, _ = sops_secrets.resolve(args.env, sops_secrets.DO)` then `fill = {n: values.get(n, "") for ns, n, _ in sops_secrets.keys_for(sops_secrets.DO) if ns == "common" and n != "MTLS_CA"}` (`:99-103`). It is the only other caller of `keys_for`.
- Behaviour to preserve: the fill set is the DO `common` keys except `MTLS_CA`; `digitalocean.PROJECT_ID` is excluded because its only namespace is `digitalocean`.

**Lands with**: `Step 1, Step 2, Step 4`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
Replace the comprehension at `:99-103` with `for n, _, nss in sops_secrets.keys_for(sops_secrets.DO) if "common" in nss and n != "MTLS_CA"`, building the same `fill` dict (key `n`, value `values.get(n, "")`). Nothing else in the file changes. The existing `group_render` cases (`scripts/sops-secrets.test.sh:494-606`) are the regression for the DO spec output.

**Verification**:
Part of the unit; run after Step 4. Local check: `ruff check scripts/do-render-app-spec.py && ruff format --check scripts/do-render-app-spec.py`; `grep -n 'ns == "common"' scripts/do-render-app-spec.py` prints nothing.

---

### Step 4 — service: workflow provides the three `LEGACY_*` lines instead of `LEGACY_APP_ENV`

**Status**: `done`
**Service**: `.github/workflows/`
**Files**:
- `.github/workflows/deploy-homelab.yml` — modify

**Reviewers**: Security — fallback names are the same-named environment secrets, no value logged; Platform Lead — workflow `LEGACY_*` set equals what `KEYS` requires

**Codebase Evidence**:
- Confirmed via: `Read .github/workflows/deploy-homelab.yml:90-107`: the `Resolve secrets` step's `env:` block ends with `LEGACY_DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}` `:105` and `LEGACY_APP_ENV: ${{ secrets.APP_ENV }}` `:106`, then `run: python3 scripts/sops_secrets.py resolve ... --target homelab` `:107`.
- Existing pattern: homelab-only keys use the plain same-named secret, e.g. `LEGACY_TS_AUTHKEY: ${{ secrets.TS_AUTHKEY }}` `:102`, `LEGACY_DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}` `:104`; this is what `expected_legacy` derives (`scripts/sops-secrets.test.sh:623-624`).
- `APP_ENV` as a job-environment variable is still produced by the resolver and consumed unchanged at `:145-148` (`bash scripts/homelab-release-env.sh "$IMAGES_ENV" ...`); the step title at `:145` stays accurate.

**Lands with**: `Step 1, Step 2, Step 3`

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
At `:106` replace `LEGACY_APP_ENV: ${{ secrets.APP_ENV }}` with three lines, in `KEYS` order, at the same indentation:
`LEGACY_DB_PASSWORD: ${{ secrets.DB_PASSWORD }}`, `LEGACY_APP_URL: ${{ secrets.APP_URL }}`, `LEGACY_SEED_USER_ID: ${{ secrets.SEED_USER_ID }}`. Do not touch any other line; `secrets.APP_ENV` must appear nowhere in the file afterwards.

**Verification**:
This is the unit's GREEN run (Steps 1-4 applied together, one commit):
```
bash scripts/sops-secrets.test.sh
ruff check scripts/sops_secrets.py scripts/do-render-app-spec.py && ruff format --check scripts/sops_secrets.py scripts/do-render-app-spec.py
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
bash scripts/homelab-render.test.sh
grep -nE 'LEGACY_APP_ENV|secrets\.APP_ENV' .github/workflows/deploy-homelab.yml
```
Expect: `sops-secrets.test.sh: all assertions passed (action resolve build render deploy produp homelab bootstrap ac24 cleanup dbnet proddown)`; both ruff commands exit 0; shellcheck and shfmt print nothing (CI `shell-lint`, `.github/workflows/ci.yml:654-668`, runs both over `scripts/*.sh`); `homelab-render.test.sh` passes unchanged; the final grep prints nothing. Confirm the cases ran, not just exited 0 (fails.md 2026-07-29): the run must print `resolve: ok` and `homelab: ok`. If `sops` is not installed locally, install the pinned binaries per `.github/actions/setup-sops/action.yml`; otherwise the CI `sops-secrets` job is the only proof and the PR must say so.

---

### Step 5 — docs: runbook describes the flat layout and namespace precedence

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/sops-secrets.md` — modify
- `scripts/homelab-render.test.sh` — modify (comment only)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `Read docs/runbooks/sops-secrets.md` (148 lines). Namespace table row `:11` (`app_env` (map of extra `.env` keys)); source-label sentence `:19-20`; preflight list `:63-68`; "Adding a key" `:115-122` (the last sentence, `:122`, says a homelab-only key needs no code edit via `homelab.app_env`); "Homelab enablement" `:124-132` (`:128` sets `homelab.app_env`, `:129-130` the common-key refusal); legacy-secret removal list `:143-146` (`APP_ENV` at `:145`).
- `grep -n "app_env" docs/runbooks/sops-secrets.md` matches lines 11, 122, 128, 129 today; AC-10 requires no case-sensitive `app_env` match afterwards. Uppercase `APP_ENV` (the opaque blob and the retired secret) is allowed.
- `scripts/homelab-render.test.sh:45` is the comment `# build <target> <app_env> <out> [mtls_ca]` above `build()` `:46-49`, which passes the value as `APP_ENV="$2"`.

**TDD**: `N/A (docs and a comment; no executable logic)`

**Covers**: `AC-10`

**Instructions**:
1. Table row `:11`: list `TS_AUTHKEY`, `TS_AUTHKEY_EXPIRES`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` (all required); drop the map.
2. After `:14-17` add the precedence rule (FR-7): a target's own namespace (`homelab` for homelab, `digitalocean` for DO) overrides a same-named `common` key, but only for names `KEYS` declares under both namespaces; an undeclared `homelab.<common name>` value is silently not an override, and unknown or misspelled keys under `homelab` are not detected. Extend the label sentence `:19-20` with `sops (<namespace>)` (for example `sops (homelab)`) and `sops (<namespace>; differs from legacy)`. State that the homelab `APP_ENV` is built from the flat keys plus the common tail, and that the legacy fallback for `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` is the same-named environment secret.
3. Preflight `:63-68`: add a bullet that `gh secret list --env staging` and `--env production` show no `APP_ENV` (no longer read; delete it if present). It is recorded as operator-asserted and unverified.
4. "Adding a key" `:117-122`: replace the sentence at `:122` so a homelab-only `.env` key also needs one `KEYS` row (namespace `homelab`) and its fallback secret line in `deploy-homelab.yml`; there is no map and no escape hatch.
5. "Homelab enablement" `:128-130`: set `DB_PASSWORD`, `APP_URL` and `SEED_USER_ID` as flat `homelab.*` keys with `sops set`; replace the common-key refusal text with the override rule; keep the quote/newline refusal sentence (value containing a single quote or line break is refused, naming the key) and add the heredoc-delimiter refusal.
6. Legacy-secret removal `:145`: list the homelab environment secrets `TS_AUTHKEY`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `MTLS_CA`, `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` (once every key reports `sops`), plus `APP_ENV` marked as no longer read.
7. `scripts/homelab-render.test.sh:45`: rename the comment's `<app_env>` to `<APP_ENV>` (comment only; no logic change).
8. Teardown (CLAUDE.md): re-read the runbook against `scripts/sops_secrets.py` after Steps 1-4 before pushing. `docs/runbooks/CLAUDE.md`'s one-line `sops-secrets.md` index row stays accurate.

**Verification**:
```
if grep -n 'app_env' docs/runbooks/sops-secrets.md; then echo "FAIL: app_env remains"; fi
sed -n '/^| `homelab`/p' docs/runbooks/sops-secrets.md | grep -F 'DB_PASSWORD' | grep -F 'APP_URL' | grep -F 'SEED_USER_ID'
grep -nF 'sops (homelab)' docs/runbooks/sops-secrets.md
grep -nF 'overrides' docs/runbooks/sops-secrets.md
bash -n scripts/homelab-render.test.sh && shellcheck scripts/homelab-render.test.sh && shfmt -d -i 2 scripts/homelab-render.test.sh
```
Expect: no `FAIL` line; the second and third commands each print at least one line; the last prints nothing and exits 0. (AC-10's `When`/`Then` are exactly these greps.)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
