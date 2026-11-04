# Implementation Spec: sops-secrets-migration

**Status**: `in-progress`
**Created**: 2026-11-04
**Feature**: `docs/roadmap/features/286-sops-secrets-migration/feature.md`
**Total Steps**: 21
**Feature Branch**: `feature/sops-secrets-migration`

---

## Execution Summary

Step 1 is the design's gating smoke test. It runs the pinned sops/age binaries and docker compose against
every CLI behaviour the design assumes; if any check fails, execution stops and goes back to the operator.
Steps 2–8 then build the shared tooling, each test step before its code step (P-06): the composite
`setup-sops` action, then `scripts/sops_secrets.py` (resolve, then build), then
`scripts/do-render-app-spec.py`. All of it is tested hermetically by one new `scripts/sops-secrets.test.sh`.
Steps 9–16 switch the consumers over one workflow at a time (DO deploy + callers, prod-up, homelab,
bootstrap). Each workflow step comes after a static-rule test that pins its `LEGACY_*` lines (AC-22).
Step 17 cleans up comments and secret names left in scripts and app specs (RED in Step 15's `ac24`/`cleanup`
groups), Step 18 wires CI, and Steps 19–21 do the runbook and the docs sweep (`docs/` tree in Step 20; the remaining
repo surfaces plus the CLAUDE.md teardown in Step 21).

The rollout itself (operator key setup, preflight, merge, bootstrap dispatch, promotions) is **not** a
step. It is the operator procedure in design.md § Rollout and the new runbook (Step 19). The live checks
the design assigns to rollout are listed under Scenario Coverage as "rollout".

**Consumer surface: None** (product spec § Consumer Surface(s): internal/platform-only; the consumers are
the deploy pipeline and the operator). This was a decision, not an omission, so no UI or Agent step is
needed (C-14).

**Pins chosen at spec time** (design § Assumptions [verify-at-spec]). The tag→SHA mappings were resolved
with `git ls-remote` and shallow tag fetches on 2026-11-04. Every pin is at least 4 weeks old.

| Pin | Value | Evidence |
|---|---|---|
| sops | `v3.13.3`, asset `sops-v3.13.3.linux.amd64`, SHA-256 `e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b` | tag commit `26e2f478…` dated 2026-07-23; the SHA matches the upstream `sops-v3.13.3.checksums.txt` line and the downloaded binary |
| age | `v1.3.2`, asset `age-v1.3.2-linux-amd64.tar.gz` (contains `age/age`, `age/age-keygen`), SHA-256 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10` | tag commit `b74dce4c…` dated 2026-08-29; SHA computed from the downloaded asset (Step 1 re-verifies it) |
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1` | already pinned at `deploy-homelab.yml:60` |
| digitalocean/action-doctl | `3cb3953159719656269e044e0e24ca16dd2a690f  # v2.5.2` | tag commit dated 2026-04-22; floating `@v2` today at `deploy.yml:83`, `prod-up.yml:28` |
| actions/upload-artifact | `cf430e030ddbb5b0abf93d22962f4752f3646cd9  # v7.0.2` | tag commit dated 2026-10-07; repo uses `@v7` (`ci.yml:312`) |
| actions/download-artifact | `37930b1c2abaa49bbe596cd826c3c89aef350131  # v7.0.0` | tag commit dated 2025-12-12; repo uses `@v7` (`ci.yml:537`), so the same major is kept |

**Placeholder coverage (verify-at-spec).** `grep -ohE 'YOUR_(DEV|PROD)_[A-Z0-9_]+' .do/app.yaml .do/app.dev.yaml`
finds exactly 10 non-MTLS names: JWT_SECRET, BROKER_ACCOUNTS_ENCRYPTION_KEY, CONFIG_SECRETS_ENCRYPTION_KEY,
SLACK_WEBHOOK_URL, SENDGRID_API_KEY, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT,
OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS. Each is a `common` KEYS entry. Beyond those
there are MTLS_CA_CERT plus MTLS_CERT_/MTLS_KEY_ for 12 suffixes, covered by `common.MTLS_CA` minting. The
only other placeholders are `YOUR_GITHUB_ORG` and `YOUR_IMAGE_TAG`. Every `YOUR_(DEV|PROD)_` occurrence is
a lone `value: YOUR_…` line: a grep for lines that do not match `^\s+value: YOUR_(DEV|PROD)_[A-Z0-9_]+\s*$`
returned nothing. This settles design Risk 1 for the current specs.

**Spec-time findings beyond the design:**

1. **The `.do/` app specs still contain `MCP_AGENT_SECRET`.** `.do/app.yaml:381` and `.do/app.dev.yaml:383`
   hold the comment "…JWT_SECRET (MCP_AGENT_SECRET retired)". AC-24 requires no match in `.do/app*.yaml`,
   so Step 17 rewords those comments. The design listed only the `:4` header edits.
2. **`.sops.yaml` generation needs a home.** The design says ".sops.yaml generation is unit-tested" (AC-7
   row) but places the generation inline in the bootstrap `pr` job. This spec puts it in a small
   `sops-config` subcommand of `scripts/sops_secrets.py` so the test can call it (Step 5/6).
3. **The test file needs group selection.** `scripts/sops-secrets.test.sh` takes optional group names
   (`action resolve build render deploy produp homelab bootstrap ac24 cleanup`; no argument runs all). Without that, each
   test/code pair could not show red-then-green on its own slice of the one test file. Step 1 creates the
   skeleton and the `action` group, so Step 2 also has a RED-first test.
4. **The `sops` CI filter also includes `.do/**` and `secrets/**`.** The AC-8 reverse-substitution test renders the real
   `.do/app*.yaml`, and `ac24` greps `secrets/*.enc.yaml`, so an edit to either must re-run the suite.
5. **Workflow YAML is parsed with `yq` (mikefarah v4)**, which is preinstalled on GitHub's ubuntu-24.04 runner image
   (`brew install yq` locally). Every static group first asserts that its workflow parses (`yq e 'true' <file>`). That is the
   workflow lint, since the repo has no actionlint (recon § Not found). The tool check fails loudly with the install hint.
6. **Merge-order (impl-spec overlap scan, WARN only).** 278 and 281 append to the same `ci.yml` ci-gate `needs`/echo
   lists, and 281 also appends to the `docs/runbooks/CLAUDE.md` index and the `docs/patterns/ci-overview.md` CI table. These are textual,
   non-blocking conflicts: whichever lands second rebases and keeps every entry. No `merge-order.md` row is required.
### Scenario Coverage (C-15)

| AC | Covered by | Kind |
|---|---|---|
| AC-1 | Step 5 (other-env key fails with `no matching keys`, own key succeeds, exactly 2 recipients) | auto; rollout re-check on the real files |
| AC-2 | Step 5 | auto |
| AC-5 | Step 3 (resolve → real `homelab-release-env.sh` → `docker compose config`) | auto |
| AC-6 | Step 5 | auto |
| AC-7 | Step 5 (`ENC[AES256_GCM,` leaves; `sops-config` output) + Step 15 (single `pr` job, `--base main-dev`, `GH_PAT`) | auto + static; rollout: the real PR |
| AC-8 | Step 7 (reverse substitution; every key reports `github` when the file is absent) | auto; one-time normalised old-vs-new comparison recorded in context.md during Step 8 |
| AC-9 | Step 3 (precedence, labels, masks emitted first) + Step 7 (rendered values) | auto |
| AC-10 | Step 3 (exact error) + Step 7 (`--out` never written) | auto |
| AC-11 | Step 7 (prod-up render to `$RUNNER_TEMP/app.yaml`) + Step 11 (static prod-up wiring) | auto |
| AC-12 | Step 13 (static, case-sensitive: no `\bop\b\|\bOP_`; case-insensitive: no `1password\|load-secrets-action`) | static; live at homelab enablement (`gate status` exit 0) |
| AC-13 | Step 3 | auto |
| AC-14 | Step 19 (inspection) | inspection |
| AC-15 | Step 5 (guard message; a fetch failure reports `cannot fetch main-dev`) | auto |
| AC-16 | Step 7 | auto |
| AC-17 | Step 9 (static + the `resolve-app-id` step run against a stub `doctl`, 1 match) | auto (permanent) |
| AC-18 | Step 3 | auto |
| AC-20 | Step 5 | auto |
| AC-21 | Step 9 (the `resolve-app-id` step against a stub `doctl`, 0 and 2 matches) | auto (permanent) |
| AC-22 | Step 3 (behaviour) + Steps 9/11/13/15 (static RHS pins) | auto + static |
| AC-23 | Step 3 | auto |
| AC-24 | Step 15 (group `ac24`: `MCP_AGENT_SECRET` absent from the named surfaces; GREEN after Steps 16–17), run in CI by Step 18 | static |

AC-3, AC-4 and AC-19 are RETIRED in `acceptance.feature` (append-only IDs, operator 2026-11-03), so no step
covers them.

## Step Dependencies

- Step 1 (gating smoke) blocks every later step. Any failed check stops the work and goes back to the operator (design § Rollout).
- Step 2 [service] pins the binaries that Steps 3–8 and CI (Step 18) install. It is covered by Step 1's `action` group (RED before Step 2).
- Step 4 [service] is covered by Step 3 [test]. Step 6 [service] by Step 5 [test]. Step 8 [service] by Step 7 [test].
- Step 6 requires Step 4: `build` reuses the module's KEYS, masking and decrypt helpers.
- Step 8 requires Step 4: `do-render-app-spec.py` imports `sops_secrets.resolve`.
- Step 10 [service] is covered by Step 9 [test]; Step 12 by Step 11; Step 14 by Step 13; Steps 16 and 17 by Step 15 (`bootstrap`, `ac24`, `cleanup`).
- Step 10 requires Step 2 (`uses: ./.github/actions/setup-sops`) and Step 8 (it calls `do-render-app-spec.py`). Likewise Step 12 requires Steps 2 and 8, Step 14 requires Steps 2 and 4, and Step 16 requires Steps 2 and 6.
- Steps 9, 11, 13 and 15 require Step 4: the static rules derive the expected `LEGACY_*` name sets from KEYS through `python3 -c` (design § AC-22 static rules).
- Step 12 requires Step 8 (prod-up calls the new renderer). It deletes `scripts/do-inject-prod-secrets.py`, and that is safe only once nothing invokes it (`prod-up.yml:60` is its only caller, confirmed by grep).
- Step 14 requires Step 4 (the homelab `resolve` CLI).
- Step 16 requires Step 6 (`build`, `sops-config`).
- Step 18 requires Steps 2–17: the new CI job runs the whole test file (every group, including `ac24`) and the composite action.
- Step 19 (runbook), Step 20 (`docs/` sweep) and Step 21 (remaining surfaces + teardown) come last. They describe the shipped workflows. Step 21 requires Step 20 (the teardown audits every touched context file).
- Design Risk 7 (`secrets[format()]` under `secrets: inherit` in a reusable job's step env) cannot be tested hermetically. It is confirmed at rollout step 3, the first deploy-dev after merge, and a failure there fails closed with MISSING. Step 1 records that it is deferred.
- Rollout (not steps): operator setup, preflight, merge, promote, bootstrap dispatch and bootstrap PR merge (design § Rollout 1–7). The legacy-secret deletion is a follow-up feature, out of scope (product spec § Out of Scope).

---

### Step 1 — test: Gating smoke test of the pinned sops/age/compose behaviour

**Status**: `done`
**Service**: `scripts/` (tooling spike + test skeleton)
**Files**:
- `docs/roadmap/features/286-sops-secrets-migration/context.md` — modify (record each check's result)
- `scripts/sops-secrets.test.sh` — create (skeleton + group `action`)

**Reviewers**: Platform Lead — cross-workflow deploy topology (DO + homelab)

**Codebase Evidence**:
- The design names this as the gate: design.md § Rollout "Execute step 1 is a gating smoke test" (lines 212–222), and § Assumptions [verify-at-execute-step-1].
- Pinned assets and SHAs: see § Execution Summary pins table (resolved 2026-11-04).
- Install pattern to mirror: `deploy-homelab.yml:198-204`, which runs `curl -fsSLO` → `sha256sum -c -` → `sudo install -m 0755`.
- The compose interpretation under test is the release `.env` path: `scripts/homelab-release-env.sh:36`, which passes APP_ENV lines through, and `scripts/homelab-render-check.sh:13`, which runs `docker compose --env-file … config`.

**TDD**: `red-green required` for the `action` group (RED before Step 2). The smoke items 1–8 are a gating spike with no repo code under test.

**Covers**: — (de-risks the assumptions behind AC-1, AC-5, AC-7 and AC-15; those scenarios are asserted in Steps 3, 5 and 7)

**Instructions**:
In a scratch directory (never the repo), download and checksum-verify the two pinned assets with the
`deploy-homelab.yml:198-204` command shape. Install `sops`, `age` and `age-keygen` into a scratch `bin/` on
`PATH`. Generate two throwaway keys with `age-keygen -o`. Then check each item below and record PASS/FAIL
with the exact command in context.md:
1. With no `.sops.yaml` anywhere above the cwd, `printf '{"common":{"A":"x"}}' | sops encrypt --input-type json --output-type yaml --filename-override secrets/staging.enc.yaml --age <pub1>,<pub2> /dev/stdin` succeeds (if `/dev/stdin` is rejected, record the working stdin form). Every leaf starts with `ENC[AES256_GCM,` and `sops.age` has 2 entries.
2. The same encrypt with `cwd` set to a scratch dir while a sibling scratch "repo" holds a `.sops.yaml` whose `creation_rules` would add a third recipient. The output still has exactly 2 recipients, which proves that `cwd=$RUNNER_TEMP` avoids the repo `.sops.yaml`.
3. `SOPS_AGE_KEY="$(cat key1)" sops decrypt --output-type json <file>` returns the JSON. Decrypting with only key2's private key on a file encrypted to pub1 alone exits non-zero, with stderr containing `no matching keys` (the AC-1 text). If the wording differs, record the exact text: Step 5 asserts whatever is recorded here.
4. `age-keygen -y` reads a private key on stdin (`printf '%s\n' "$K" | age-keygen -y`) and prints the matching recipient.
5. A `.sops.yaml` with `creation_rules: - path_regex: secrets/staging\.enc\.yaml$` and an `age:` list is picked up by `sops encrypt secrets/staging.enc.yaml`, run from the scratch repo root (relative `path_regex` matching).
6. `docker compose --env-file f.env -f c.yml config --format json` with `f.env` holding `A='p$w #1 "x"'`, `B='j$t'` and `C='tr ail '` resolves A, B and C byte-exactly (single quotes disable `$` interpolation and keep the trailing space). Also record how `$$` inside single quotes is treated.
7. A JSON round-trip of `"trail-v \n"` through encrypt → `decrypt --output-type json` → `json.loads` is byte-equal.
8. Record design Risk 7 (`secrets[format('{0}_K', env.P)]` under `secrets: inherit`) as **deferred to the first deploy-dev** (rollout step 3). It cannot be exercised outside Actions.
9. Confirm `yq --version` reports mikefarah v4 locally, and record it. The runner image ships it (spec-time finding 5).

**Test skeleton.** Create `scripts/sops-secrets.test.sh`, executable and shellcheck/shfmt clean (`-i 2`). It has:
- `#!/usr/bin/env bash`, a 2-line header naming what it tests, `set -uo pipefail`, and `cd "$(git rev-parse --show-toplevel)"`, so relative paths such as `sys.path.insert(0,"scripts")` and `.github/workflows/…` resolve from the repo root;
- `fail()` and a `work` mktemp with an EXIT trap;
- a per-group tool check: `yq` for every group, plus `sops age age-keygen docker jq python3 openssl git` for the groups that run them. A missing tool fails with an install hint;
- group dispatch: `groups="${*:-action resolve build render deploy produp homelab bootstrap ac24 cleanup}"`. Each group is a function, and an unknown name fails. The later test steps add the remaining functions.

Group `action` asserts, on `.github/actions/setup-sops/action.yml`:
- the file exists and parses (`yq e 'true'`), and `.runs.using == "composite"`;
- the step env holds exactly `SOPS_VERSION=3.13.3`, `AGE_VERSION=1.3.2` and the two full SHA-256 values from the pins table;
- the run text holds two `sha256sum -c -` checks and the two release URLs built from `${SOPS_VERSION}`/`${AGE_VERSION}`;
- the file has 0 `uses:` lines.
**Verification**:
Every item 1–7 and 9 is recorded PASS in context.md, with the commands used. If any item is FAIL, stop: mark the
step `blocked` and escalate to the operator (design § Rollout: "Any failure stops the work"). Item 8 is
recorded as deferred.
```bash
bash scripts/sops-secrets.test.sh action   # RED (action.yml absent) before Step 2
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 2 — service: Composite action `setup-sops` (pinned sops + age)

**Status**: `done`
**Service**: `.github/actions/setup-sops`
**Files**:
- `.github/actions/setup-sops/action.yml` — create

**Reviewers**: Security — supply chain of secret-handling binaries; Platform Lead — cross-workflow deploy topology

**Codebase Evidence**:
- No `.github/actions/` directory exists today (`ls .github/actions` → absent). This is the first composite action, and no existing pattern is available in the codebase.
- The install shape to reuse is `deploy-homelab.yml:198-204` (Tailscale: VERSION and SHA256 kept in workflow `env`, `curl -fsSLO`, `sha256sum -c -`, `sudo install -m 0755`). The same shape is used for the op CLI at `:125-135`.
- The pin values are in § Execution Summary pins table.
- Design C3 (design.md:107-112): no third-party `uses:` inside the action, 5 consumers.

**TDD**: `red-green required` (covered by Step 1's `action` group)

**Covers**: — (covered by Step 1)

**Instructions**:
Create a `runs: using: composite` action with no inputs. Put the pins in a single step's `env`:
`SOPS_VERSION: "3.13.3"`, `SOPS_SHA256: e5bec334…ef6b` (full value from the pins table), `AGE_VERSION: "1.3.2"`,
`AGE_SHA256: cbe24006…ac10` (full value). Add one `shell: bash` step that does the following in `$RUNNER_TEMP`:
1. `curl -fsSLO https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64`, then `echo "${SOPS_SHA256}  sops-v${SOPS_VERSION}.linux.amd64" | sha256sum -c -`, then `sudo install -m 0755 sops-v${SOPS_VERSION}.linux.amd64 /usr/local/bin/sops`.
2. `curl -fsSLO https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz`, then sha256sum-check it, `tar xzf`, and `sudo install -m 0755 age/age age/age-keygen /usr/local/bin/`.
3. `sops --version && age --version`.

Add a one-line header comment stating the constraint: these pins are the only home of the sops/age
versions, so bump them here.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh action   # GREEN
```
The real install (`sudo install … /usr/local/bin`) mutates its host, so it is **not** run on a developer machine.
It is proven by the Step 18 CI job, which `uses: ./.github/actions/setup-sops` on an ephemeral runner and then runs every
group against the installed binaries. In an ephemeral execute sandbox, the install block may also be run directly:
```bash
T=$(mktemp -d); yq e '.runs.steps[0].run' .github/actions/setup-sops/action.yml >"$T/install.sh"
env $(yq e '.runs.steps[0].env | to_entries | .[] | .key + "=" + .value' .github/actions/setup-sops/action.yml) RUNNER_TEMP="$T" bash "$T/install.sh"
sops --version | grep -q '3.13.3' && age --version | grep -q 'v1.3.2'
```

---

### Step 3 — test: Resolver cases (`resolve` library + homelab CLI)

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (group `resolve`)

**Reviewers**: Security — no plaintext in logs; fail-closed resolution

**Codebase Evidence**:
- Test style to reuse: `scripts/homelab-render.test.sh`, which has `set -uo pipefail` (:4), `fail()` (:8-11), mktemp + trap (:21-22), the `SECRETPROBE` canary (:25), the `env -i` hermetic call (:47-48) and numbered cases (`# 1.`…`# 9.`).
- Fixture CA builder: `homelab-render.test.sh:27-28` (`gen-dev-certs.sh` with `CA_CN`, then the base64 JSON bundle). The C-13 waiver (design.md:411) allows this as a second inline consumer, because `scripts/` has no canonical fixture home (`docs/patterns/test-data-inventory.md:70-83`).
- The release contract that AC-5/AC-18 run through is `scripts/homelab-release-env.sh:13` (APP_ENV and MTLS_CA required), `:34` (the `owned` regex) and `:36` (pass-through).
- The existing source-report shape is `deploy-homelab.yml:166-172` (`### Secret sources`, `- $n: $src`).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-9, AC-10, AC-13, AC-18, AC-22, AC-23`

**Instructions**:
Extend the Step 1 skeleton. Add a helper that generates throwaway staging,
production and operator age keys, and a helper that writes a test SOPS file. The helper calls
`sops encrypt --input-type json --output-type yaml --age <env>,<operator>` with `cwd=$work`, to
`$work/repo/secrets/<env>.enc.yaml`. The resolver is pointed at that file with a `--file` argument (CLI) or
`file=` (library), never at the repo's `secrets/`.

Group `resolve` cases. Every invocation is `env -i PATH HOME TMPDIR …` with only the named `LEGACY_*`/`SOPS_AGE_KEY`:
1. **File absent → all github.** No file and every `LEGACY_*` set → every KEYS name for the target is reported `github` (AC-8 label half).
2. **Precedence + per-key fallback (AC-9).** The file has `common.JWT_SECRET=jwt-sops` and no SENDGRID. With `LEGACY_JWT_SECRET=jwt-gh` and `LEGACY_SENDGRID_API_KEY=sg-gh`, the result is JWT=`jwt-sops` (`sops (differs from legacy)` plus a `::warning::` naming JWT_SECRET) and SENDGRID=`sg-gh` (`github`). Every `::add-mask::` line comes before any other stdout line.
3. **Required missing (AC-10).** CONFIG_SECRETS_ENCRYPTION_KEY is in neither store → exit 1, stderr has `CONFIG_SECRETS_ENCRYPTION_KEY is in neither SOPS nor the GitHub secrets`, and the value probe appears nowhere.
4. **Undecryptable file.** The file is present and `SOPS_AGE_KEY` is empty → hard fail. With the wrong key → `cannot decrypt secrets/staging.enc.yaml (sops exit N)`, with no per-key fallback even though `LEGACY_*` is set.
5. **Non-string leaf.** `common.JWT_SECRET: 5` gives `common.JWT_SECRET must be a string`.
6. **AC-22 behaviour.** The file is absent, `LEGACY_MTLS_CA=<fixture CA>`, and the environment also carries `MTLS_CA=<other CA>` → the resolved MTLS_CA is the fixture CA.
7. **Homelab CLI (AC-13).** `resolve --env staging --target homelab --github-env $work/ghenv --file …` with the file lacking `homelab.DEPLOY_KNOWN_HOSTS` and `LEGACY_DEPLOY_KNOWN_HOSTS` set → the summary has `DEPLOY_KNOWN_HOSTS: github`. `$work/ghenv` holds `NAME<<ghadelim_…` heredocs for TS_AUTHKEY, TS_AUTHKEY_EXPIRES, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, MTLS_CA and APP_ENV.
8. **AC-5 + AC-18.** The file has `homelab.app_env={APP_URL: https://x.example, DB_PASSWORD: p$w #1 "x", DB_HOST: ignored, SEED_USER_ID: …}` and `common.JWT_SECRET=j$t`, plus the other required common keys and the fixture CA. Parse APP_ENV and MTLS_CA out of `ghenv`, then run the real `scripts/homelab-release-env.sh` and `docker compose config --format json` (as in `homelab-render.test.sh:51`). Assert DB_PASSWORD=`p$w #1 "x"` and JWT_SECRET=`j$t` byte-exact. Assert every app_env line precedes the first common-tail line. Assert `MTLS_CA_CERT` equals the fixture `ca.pem`.
9. **AC-23.** `homelab.app_env.JWT_SECRET=jwt-x` alongside `common.JWT_SECRET=jwt-do` → exit 1 with `homelab.app_env must not contain common key JWT_SECRET`. Neither `jwt-x` nor `jwt-do` appears in stdout or stderr.
10. **Legacy APP_ENV branch.** No `homelab.app_env`, and `LEGACY_APP_ENV` contains `export JWT_SECRET=old` and `JWT_SECRET: old2` lines → both are dropped, and the tail carries the DO value last.
11. **Refusals.** An app_env value containing `'` or a newline, a key failing `^[A-Za-z_][A-Za-z0-9_]*$`, or a value containing the heredoc delimiter is each refused with an error that names the key.
12. **No normalisation.** `"trail-v \n"` is byte-equal through resolve on both paths (sops and legacy).
13. **Leak canary.** A `SECRETPROBE` value appears in no stderr, and none of its 4+-char lines is left unmasked.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh resolve   # RED before Step 4 (scripts/sops_secrets.py absent); GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
New logic lives in `scripts/`, which has no CI coverage threshold (`docs/patterns/ci-overview.md`). The
hermetic suite is the verification.

---

### Step 4 — service: `scripts/sops_secrets.py` — KEYS, `resolve`, homelab `resolve` CLI

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/sops_secrets.py` — create

**Reviewers**: Security — masking order, fail-closed, names-only errors; Platform Lead — one KEYS table shared by DO and homelab

**Codebase Evidence**:
- **Not found**: no SOPS/age or `::add-mask::` use exists anywhere (recon § Risks), so this is built from scratch per design C1 (design.md:20-85).
- The common key set matches `deploy.yml:107-116` plus `:93` (MTLS_CA), and `do-inject-prod-secrets.py:33-53`.
- The homelab key set matches `deploy-homelab.yml:146-151` (TS_AUTHKEY, TS_AUTHKEY_EXPIRES, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, APP_ENV, MTLS_CA).
- The `owned` regex to mirror for legacy-blob stripping is `scripts/homelab-release-env.sh:34`.
- OTEL is do-only because `deploy/homelab/compose.yml:7` hardcodes `OTEL_ENABLED: "false"`.
- The summary shape is `deploy-homelab.yml:166-172`.
- stdlib-only Python is an existing deploy dependency (`deploy.yml:130`, `mtls-provision.sh:58`).

**TDD**: `red-green required`

**Covers**: — (covered by Step 3)

**Instructions**:
Implement design C1 exactly (design.md:20-85), stdlib only, Python 3.12-compatible (the ubuntu-24.04 runner
python). The pieces:
- **`KEYS`:** tuples `(ns, name, required, targets)` per the design table. The 11 `common` names, `digitalocean.PROJECT_ID`, and the homelab names TS_AUTHKEY, TS_AUTHKEY_EXPIRES, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS and `app_env` (homelab entries R for `target="homelab"`). Add derived helpers for the legacy names per target and the homelab-tail set (8 app keys).
- **`resolve(env, target, file=None)`:**
  - Validates `env ∈ {staging, production}`. The default file is `dirname(dirname(abspath(__file__)))/secrets/<env>.enc.yaml`.
  - If the file is absent, every key comes from `LEGACY_<NAME>` with source `github`. If the file is present, decrypt with `subprocess.run(["sops","decrypt","--output-type","json",path], capture_output=True)`. If `SOPS_AGE_KEY` is empty, fail. On a non-zero exit, drop stderr and fail with `cannot decrypt secrets/<env>.enc.yaml (sops exit N)`.
  - Enforce `isinstance(str)` on every leaf.
  - Print `::add-mask::` for every value ≥4 chars and for each of its ≥4-char lines, **before** any other output.
  - Precedence: sops, then legacy. Presence means `!= ''`. Values are never stripped or normalised.
  - Report `sops (differs from legacy)` plus a `::warning::` when both are present and their SHA-256 differ.
  - Append `### Secret sources` / `- K: <src>` to `$GITHUB_STEP_SUMMARY` when it is set.
  - For a required key that is missing: `K is in neither SOPS nor the GitHub secrets`, then `sys.exit(1)` once every key has been reported.
  - Return `(values: dict, sources: dict)`.
- **CLI `resolve --env E --target homelab --github-env PATH [--file F]`:** builds APP_ENV as body + tail exactly per design.md:50-59, then writes the 6 heredocs (`NAME<<ghadelim_<uuid4 hex>`, value, `\n`, delimiter). It refuses a value containing its delimiter.
- Errors name keys only.
- Put the design's import rule as a ≤2-line comment above any `sys.path` use: "imported via sys.path insert by do-render-app-spec.py; never run with python3 -I".

**Verification**:
```bash
bash scripts/sops-secrets.test.sh resolve
ruff check scripts/sops_secrets.py && ruff format --check scripts/sops_secrets.py
```

---

### Step 5 — test: Bootstrap `build` + `sops-config` cases

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (group `build`)

**Reviewers**: Security — per-env key isolation, no plaintext on disk or in logs

**Codebase Evidence**:
- Design C1 `build` (design.md:61-83) and the AC test table rows AC-1/2/6/7/15/20 (design.md:302-314).
- Guard fetch semantics: the narrow-refspec trap at `sync-main-to-maindev.yml:36-40`. The design guard uses `git fetch --depth=1 origin main-dev` + `git ls-tree --name-only FETCH_HEAD` (design.md:65-67).
- Step 1 item 3 records the exact "no matching keys" stderr text.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-6, AC-7, AC-15, AC-20`

**Instructions**:
Add group `build`. Each case creates `$work/origin.git` (bare) and a clone `$work/repo` containing a copy of
`scripts/sops_secrets.py`, with origin set to the bare repo. Commit an empty `main-dev`, push, and run the
copy from the clone. Cases:
1. **AC-2/AC-20.** `LEGACY_JWT_SECRET=jwt-do` and `LEGACY_PROJECT_ID=proj-9`, all other required keys set, and `TS_AUTHKEY=tskey-x` / `APP_ENV=…` in the environment. `build --env staging --out $work/out` succeeds. Decrypting `$work/out/staging.enc.yaml` with the staging key gives top-level keys exactly `{common, digitalocean}`, `common.JWT_SECRET=jwt-do` and `digitalocean.PROJECT_ID=proj-9`. `tskey-x` appears nowhere. DIGITALOCEAN_ACCESS_TOKEN, GH_PAT, BUF_TOKEN and APP_ID are in no namespace.
2. **AC-1.** Decrypting the production output with only the staging key exits non-zero, stderr contains the Step 1 text, and no value is printed. The own key exits 0. `sops.age` lists exactly 2 recipients: the env key and `SOPS_OPERATOR_AGE_RECIPIENT`.
3. **AC-7.** Every leaf value in the output starts with `ENC[AES256_GCM,`. `$work/out/staging.recipient` equals `age-keygen -y` of the staging key.
4. **AC-6.** With `LEGACY_JWT_SECRET` unset for production → exit 1, stderr has `JWT_SECRET is required but missing`, nothing is written to `--out`, and the probe is absent from stdout, stderr and the out dir.
5. **AC-15.** Commit `secrets/staging.enc.yaml` to origin `main-dev` → `build --env staging` fails with `secrets/staging.enc.yaml already exists; re-run with force=true to overwrite`. With `--force` it succeeds and writes `staging.changes.md`, which lists added/changed/unchanged/removed **key names only** (the probe value is absent).
6. **Fetch failure.** Point origin at a missing path → `cannot fetch main-dev`. It is never treated as absent.
7. **Absent optional.** An unset `LEGACY_SLACK_WEBHOOK_URL` is omitted from the file, not written as `""`.
8. **No normalisation.** `"trail-v \n"` survives build → self-verify → decrypt byte-equal.
9. **`sops-config`.** Given `staging.recipient`, `production.recipient` and `SOPS_OPERATOR_AGE_RECIPIENT`, stdout is a `.sops.yaml` with two `creation_rules` (`path_regex: secrets/staging\.enc\.yaml$`, `age: <stg>,<op>`, and the same for production). Encrypting `secrets/staging.enc.yaml` with it from the clone root yields those 2 recipients (Step 1 item 5).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh build   # RED before Step 6; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 6 — service: `scripts/sops_secrets.py` — `build` and `sops-config` CLIs

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/sops_secrets.py` — modify

**Reviewers**: Security — force guard, self-verify, ciphertext-only outputs

**Codebase Evidence**:
- Design C1 `build` steps 1–8 (design.md:61-83).
- The two-recipient `.sops.yaml` shape: design C7 `pr` step 4 (design.md:202).
- The KEYS, masking and decrypt helpers come from Step 4 (same file).

**TDD**: `red-green required`

**Covers**: — (covered by Step 5)

**Instructions**:
Add `build --env E --out DIR [--force]`, following design.md:61-83 in order:
1. Mask every `LEGACY_*` value.
2. Run the guard with `cwd` = repo root (`dirname(dirname(abspath(__file__)))`).
3. Run the required check (`K is required but missing`).
4. Derive the env recipient with `age-keygen -y` (`SOPS_AGE_KEY` on stdin).
5. Encrypt: `json.dumps({"common":…,"digitalocean":…})` piped to `sops encrypt --input-type json --output-type yaml --filename-override secrets/E.enc.yaml --age <env>,<SOPS_OPERATOR_AGE_RECIPIENT>`, with `cwd=os.environ["RUNNER_TEMP"]` (falling back to a `tempfile.mkdtemp()` when it is unset). Write `DIR/E.enc.yaml`.
6. Self-verify every property in design.md:74-79.
7. Write `DIR/E.recipient`.
8. With `--force`, decrypt the FETCH_HEAD blob (`git show FETCH_HEAD:secrets/E.enc.yaml` piped to `sops decrypt --input-type yaml --output-type json /dev/stdin`, or the stdin form recorded in Step 1) and write `DIR/E.changes.md` with names only.

Fail if `SOPS_OPERATOR_AGE_RECIPIENT` is empty. Plaintext never touches disk.

Add `sops-config DIR`, which prints the two-rule `.sops.yaml` from `DIR/staging.recipient`,
`DIR/production.recipient` and `$SOPS_OPERATOR_AGE_RECIPIENT`.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh resolve build
ruff check scripts/sops_secrets.py && ruff format --check scripts/sops_secrets.py
```

---

### Step 7 — test: DO renderer cases (AC-8 reverse substitution, prod-up render)

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (group `render`)

**Reviewers**: Security — byte-identical delivery of CONFIG/BROKER/JWT keys; Platform Lead — DO spec parity

**Codebase Evidence**:
- The substitution behaviour to preserve: `deploy.yml:118-121` (sed of `YOUR_GITHUB_ORG`/`YOUR_IMAGE_TAG`), `:133-164` (DEV/PROD replace pairs; optionals default `''` via `os.environ.get(…, '')` at :142-160), `:161-162` (OTEL `Authorization=` prefix), `:177-183` (`yaml_pem`), `:185-192` (CA and leaf replace), `:193-196` (MTLS leftover check).
- The real specs: `.do/app.yaml:5` `name: xstockstrat-production`, `.do/app.dev.yaml:5` `name: xstockstrat-staging`. Every `YOUR_(DEV|PROD)_` placeholder sits on its own `value:` line (spec-time grep, § Execution Summary). `${xstockstrat.CA_CERT}` appears 5 times in each spec (`.do/app.yaml:436,483,532,…`).
- The leaf pubkey-match method is `mtls-provision.sh:88-90`. The SAN is `xstockstrat-<svc>` (`gen-dev-certs.sh:28-31` SERVICES).
- The reverse-substitution algorithm: design.md:322-346.

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9, AC-10, AC-11, AC-16`

**Instructions**:
Add group `render`. Like Step 5, run a **copy**: copy `scripts/do-render-app-spec.py`, `scripts/sops_secrets.py`,
`scripts/mtls-provision.sh` and `scripts/gen-dev-certs.sh` into `$work/repo/scripts/` and invoke the copy. The
resolver's `__file__`-relative default then reads `$work/repo/secrets/<env>.enc.yaml`. That file is absent for the
file-absent cases and written by the Step 3 helper for the SOPS cases, so the group never reads the repo's real `secrets/` (which exists
once the bootstrap PR merges). For each real spec (`.do/app.dev.yaml` with `--env staging --app-name xstockstrat-staging`,
and `.do/app.yaml` with `--env production --app-name xstockstrat-production`):
1. **AC-8 reverse substitution.** Run `python3 $work/repo/scripts/do-render-app-spec.py --env E --spec S --app-name N --image-tag abc1234 --org testorg --out $work/r.yaml` with the file absent. Set each `LEGACY_<K>` to a fixed-width sentinel `__S286_NN__` and `LEGACY_MTLS_CA` to the fixture CA. Build the sed-only baseline with `sed -e s/YOUR_GITHUB_ORG/testorg/g -e s/YOUR_IMAGE_TAG/abc1234/g S`, and assert no sentinel occurs in it. Diff line by line: every differing line must be a placeholder line. Map back sentinels, `Authorization=<sentinel>`, the exact CA `yaml_pem`, and leaf PEMs. A leaf PEM is mapped back only after these checks pass: it matches the PEM regex, its SAN is `xstockstrat-<sfx>`, it verifies against the fixture CA (`openssl verify -CAfile`), and its key pubkey equals the cert pubkey. The mapped-back text must be byte-equal to the baseline. Any failure names the line.
2. **Summary (AC-8).** The step summary lists `<K>: github` for every do-target KEYS entry.
3. **AC-9 render.** With a SOPS file holding `common.JWT_SECRET=jwt-sops` and `LEGACY_SENDGRID_API_KEY=sg-gh`, the rendered spec carries `jwt-sops` and `sg-gh`.
4. **AC-10.** CONFIG_SECRETS_ENCRYPTION_KEY is in neither store → exit 1 with the exact message, and `--out` does not exist afterwards.
5. **AC-11/AC-16.** Render the production spec to `$work/RUNNER_TEMP/app.yaml` with the SOPS file holding `common.JWT_SECRET=jwt-sops`, `common.VAPID_PUBLIC_KEY=BPub` and `common.MTLS_CA`. The output contains `jwt-sops` and `BPub`, and has no `YOUR_PROD_VAPID_`, `YOUR_PROD_MTLS_` or other `YOUR_(DEV|PROD)_` left. File mode is `-rw-------`.
6. **Targeted asserts:**
   - OTEL prefix in both cases (`Basic x` becomes `Authorization=Basic x`; `Authorization=Basic x` is unchanged).
   - An absent optional renders `''`.
   - `${xstockstrat.CA_CERT}` count is unchanged.
   - `--app-name` mismatching the spec's `name:` fails.
   - Every `yaml_pem` string (CA, leaf cert, leaf key) and every value is preceded by its `::add-mask::` on stdout.
   - `GITHUB_OUTPUT` receives `app_name=` and `project_id=` only.

Implement the reverse map (line diff, sentinel/PEM map-back, openssl checks) as a single `python3 - <<'PY'` heredoc
inside the group function, with the openssl calls via `subprocess`. Do not hand-roll it in bash, and add no new file (C-18).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh render   # RED before Step 8; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 8 — service: `scripts/do-render-app-spec.py` (unified DO renderer)

**Status**: `done`
**Service**: `scripts/`
**Files**:
- `scripts/do-render-app-spec.py` — create

**Reviewers**: Security — masks before output, 0600 spec, temp-dir cleanup; Platform Lead — one substitution path for deploy and prod-up

**Codebase Evidence**:
- It replaces two hand-synced copies: the inline python at `deploy.yml:130-198` and `scripts/do-inject-prod-secrets.py:33-77`. That module's docstring at `:13-15` admits it "mirror[s] deploy.yml". This is the C-10 DRY hazard the design consolidates.
- The mint sequence: `deploy.yml:99-102` (`mtls-provision.sh decode-ca "$certs_dir"` → `CERTS_DIR=… gen-dev-certs.sh`). `decode_ca` reads `MTLS_CA` from the env only (`mtls-provision.sh:73-94`).
- `yaml_pem` is at `deploy.yml:177-183`.
- `resolve` comes from Step 4.

**TDD**: `red-green required`

**Covers**: — (covered by Step 7)

**Instructions**:
Implement design C2 steps 1–10 (design.md:87-105). Arguments: `--env --spec --app-name --image-tag --org --out`.
1. Use `sys.path.insert(0, dirname(abspath(__file__)))`, then `import sops_secrets`.
2. Assert the spec's top-level `^name:` equals `--app-name`.
3. Apply the `YOUR_GITHUB_ORG`/`YOUR_IMAGE_TAG` replace.
4. `values, sources = sops_secrets.resolve(env, "do")`.
5. For each do-target non-MTLS KEYS name `K`, replace `YOUR_DEV_K` and `YOUR_PROD_K` with the value, or with `''` when it is absent. Keep the OTEL prefix rule.
6. Mint in a `tempfile.mkdtemp()` (0700). Run `bash scripts/mtls-provision.sh decode-ca <dir>` with `env={**os.environ, "MTLS_CA": value}` (subprocess env only), then `gen-dev-certs.sh` with `CERTS_DIR=<dir>`. Print `::add-mask::` for every `yaml_pem(...)` string and each of its lines before replacing it.
7. Run the MTLS leftover check and the global `YOUR_(DEV|PROD)_` leftover check.
8. `shutil.rmtree` the temp dir in a `finally:`.
9. Write `--out` via `os.open(path, O_WRONLY|O_CREAT|O_TRUNC, 0o600)`, only after every check passes.
10. Append `app_name` and `project_id` (from `values.get("PROJECT_ID","")`) to `$GITHUB_OUTPUT`.

Never write the spec to stdout.

**Parity record (design Risk 2):** once green, run the old inline python (`git show HEAD:.github/workflows/deploy.yml`,
extract the `:130-198` block) and the new renderer on `.do/app.dev.yaml`, using the same sentinel `LEGACY_*`
values and the same fixture CA tree (point both at one pre-minted `MTLS_CERTS_DIR` by reusing the minted
dir). Diff the outputs after normalising the leaf `yaml_pem` blocks. Record the result in context.md as the list-item line
`- PARITY RECORD (286 step 8): identical`, or `- PARITY RECORD (286 step 8): <exact differences>`.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh resolve render
ruff check scripts/do-render-app-spec.py scripts/sops_secrets.py && ruff format --check scripts/do-render-app-spec.py scripts/sops_secrets.py
grep -n "^- PARITY RECORD (286 step 8):" docs/roadmap/features/286-sops-secrets-migration/context.md
```

---

### Step 9 — test: Static rules for `deploy.yml` and its callers

**Status**: `done`
**Service**: `.github/workflows`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (group `deploy`)

**Reviewers**: Security — fallback RHS pinning (no CA shadowing)

**Codebase Evidence**:
- The rules and their expected texts: design.md:348-373.
- Today's surfaces that the rules must reject: the `secrets:` block at `deploy.yml:14-75` (incl. `DO_APP_ID` :17), the explicit passthroughs at `deploy-dev.yml:47-61` (`DO_APP_ID: secrets.DO_DEV_APP_ID` :49) and `deploy-prod.yml:46-60` (:48), and the unprefixed `secrets.JWT_SECRET` etc. at `deploy.yml:107-116`.
- The homelab gates that must stay intact: `deploy-dev.yml:69` `vars.HOMELAB_STAGING_ENABLED` and `deploy-prod.yml:68` `vars.HOMELAB_PRODUCTION_ENABLED`.

**TDD**: `red-green required`

**Covers**: `AC-17, AC-21, AC-22`

**Instructions**:
Add group `deploy`. First assert that each of `deploy.yml`, `deploy-dev.yml` and `deploy-prod.yml` parses (`yq e 'true'`). Derive the do-target legacy name set from KEYS with
`python3 -c 'import sys; sys.path.insert(0,"scripts"); import sops_secrets as s; …'`. Assert on `.github/workflows/deploy.yml`:
- Every `^\s*LEGACY_[A-Z0-9_]+:` line exactly equals `LEGACY_<K>: ${{ secrets[format('{0}_<K>', env.P)] }}`, or for PROJECT_ID `LEGACY_PROJECT_ID: ${{ secrets[format('DO_{0}_PROJECT_ID', env.P)] }}`. There are 12 such lines, the name set equals the KEYS set, and each name occurs once.
- Exactly one job-level `P: ${{ inputs.environment == 'production' && 'PROD' || 'DEV' }}`, and no step-level `P:`.
- No unprefixed `secrets.<common K>`.
- No `DO_APP_ID`, `DO_DEV_APP_ID` or `DO_PROD_APP_ID`.
- An `environment: ${{ inputs.environment }}` on job `deploy`, plus a `validate` job with no `environment:`.
- The app-ID step has `id: resolve-app-id`.
- **AC-17/AC-21 behaviour (permanent).** Extract the step's run block with
  `yq e '.jobs.deploy.steps[] | select(.id == "resolve-app-id") | .run' .github/workflows/deploy.yml`. Run it under
  `env -i` with a `PATH` stub `doctl` that prints 0, 1 (`app-new xstockstrat-staging`) or 2 matching rows, plus an unrelated
  `x9 xstockstrat-production` row in every case. Set `APP_NAME=xstockstrat-staging`, and point `GITHUB_ENV`/`GITHUB_STEP_SUMMARY` at `$work` files.
  - 0 rows: exit 1 with `expected exactly 1 app named xstockstrat-staging, found 0`.
  - 1 row: exit 0, `GITHUB_ENV` has `APP_ID=app-new`, and the summary has `app: xstockstrat-staging → app-new`.
  - 2 rows: exit 1, `found 2`.

On `deploy-dev.yml` / `deploy-prod.yml`, assert:
- job `deploy` has `secrets: inherit` and no `secrets:` mapping;
- `with:` carries `environment: staging` / `environment: production`;
- the `deploy-homelab` job keeps `if: vars.HOMELAB_STAGING_ENABLED == 'true'` (`deploy-dev.yml`) or `if: vars.HOMELAB_PRODUCTION_ENABLED == 'true'` (`deploy-prod.yml`) (`yq e '.jobs.deploy-homelab.if'`), `uses: ./.github/workflows/deploy-homelab.yml`, `secrets: inherit`, and `with.environment` staging/production. The assertion is on content, not a cross-branch diff, so it works on CI's shallow checkout.

Use `yq` for structure, and grep for the exact `LEGACY_*`/`P:` line texts.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh deploy   # RED before Step 10; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 10 — service: Rewrite `deploy.yml`; switch `deploy-dev.yml` / `deploy-prod.yml` to `secrets: inherit`

**Status**: `done`
**Service**: `.github/workflows`
**Files**:
- `.github/workflows/deploy.yml` — modify (rewrite)
- `.github/workflows/deploy-dev.yml` — modify
- `.github/workflows/deploy-prod.yml` — modify

**Reviewers**: Security — environment binding, no secret in GITHUB_ENV; Platform Lead — env-bound reusable workflow, production reviewer gate on every main push

**Codebase Evidence**:
- `deploy.yml`:
  - inputs at `:5-13`; `secrets:` at `:14-75`; job `deploy` at `:78` with no `environment:` or `permissions:`.
  - floating `actions/checkout@v7` at `:81` and `digitalocean/action-doctl@v2` at `:83`.
  - mint at `:87-103`, substitute at `:105-198`.
  - `DO_APP_ID` at `:203`, `:213`, `:220`; project assign at `:205-216`; wait loop at `:218-236`.
- By-name lookup to reuse: `prod-up.yml:35-36` (`doctl apps list --format ID,Spec.Name --no-header | awk '$2=="xstockstrat-production"{print $1}'`).
- Callers: `deploy-dev.yml:43-64` and `deploy-prod.yml:42-63`.
- Fail-closed rationale and the env-secret shadowing scar: `docs/roadmap/ledger/insights.md` 2026-11-03 sops-secrets-migration entry (and design C4, design.md:114-121).

**TDD**: `red-green required`

**Covers**: — (covered by Step 9, including AC-17/AC-21)

**Instructions**:
Rewrite `deploy.yml` per design C4 and § Per-workflow step order (design.md:153-168).

**Inputs.** `environment` (string, required), `app_spec`, `image_tag`. Delete the whole `secrets:` block.

**Job `validate`** (no environment): `env: E: ${{ inputs.environment }}`, then
`case "$E" in staging|production) ;; *) echo "::error::environment must be staging or production"; exit 1;; esac`.

**Job `deploy`:**
- `needs: validate`, `environment: ${{ inputs.environment }}`, `permissions: {contents: read}`.
- Job `env`: `P: ${{ inputs.environment == 'production' && 'PROD' || 'DEV' }}` and `APP_NAME: xstockstrat-${{ inputs.environment }}`.
- Steps:
  1. Pinned checkout `3d3c42e5…  # v7.0.1`.
  2. Pinned doctl `3cb39531…  # v2.5.2` with `secrets.DIGITALOCEAN_ACCESS_TOKEN`.
  3. **Resolve app ID** (`id: resolve-app-id`): `ids=$(doctl apps list --format ID,Spec.Name --no-header | awk -v n="$APP_NAME" '$2==n{print $1}')`, then `n=$(printf '%s' "$ids" | grep -c . || true)`. Unless `n` is 1, fail with `expected exactly 1 app named $APP_NAME, found $n`. Write `APP_ID=…` to `$GITHUB_ENV` and `app: $APP_NAME → $ids` to `$GITHUB_STEP_SUMMARY`.
  4. `uses: ./.github/actions/setup-sops`.
  5. **Render** (`id: render`): `env:` holds `SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}` plus the 12 `LEGACY_*` lines in the exact Step 9 text. Run `python3 scripts/do-render-app-spec.py --env "${{ inputs.environment }}" --spec "${{ inputs.app_spec }}" --app-name "$APP_NAME" --image-tag "${{ inputs.image_tag }}" --org "${{ github.repository_owner }}" --out "$RUNNER_TEMP/app.yaml"`.
  6. `doctl apps update "$APP_ID" --spec "$RUNNER_TEMP/app.yaml" --update-sources`.
  7. Project assign: keep `continue-on-error: true`, read `DO_PROJECT_ID: ${{ steps.render.outputs.project_id }}`, and use `--resource "do:app:$APP_ID"`.
  8. The wait loop, unchanged except `APP_ID="$APP_ID"`.
  9. `if: always()`: `rm -f "$RUNNER_TEMP/app.yaml"`.

Keep the existing `--update-sources` comment (`:201-202`).

**Callers.** In `deploy-dev.yml` / `deploy-prod.yml`, job `deploy` only: replace `secrets:` `:47-61` / `:46-60` with
`secrets: inherit`, and set `with:` to `environment: staging|production`, `app_spec` and `image_tag`. Do not
touch the `prepare`, `buf-push*`, `build-images` or `deploy-homelab` jobs.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh deploy render   # GREEN (includes the AC-17/AC-21 stub-doctl cases)
yq e 'true' .github/workflows/deploy.yml .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml >/dev/null
```

---

### Step 11 — test: Static rules for `prod-up.yml`

**Status**: `done`
**Service**: `.github/workflows`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (group `produp`)

**Reviewers**: Security — literal PROD_* fallbacks only

**Codebase Evidence**:
- The prod-up expected texts are at design.md:363 (`${{ secrets.PROD_<K> }}`, `${{ secrets.DO_PROD_PROJECT_ID }}`).
- Today's `prod-up.yml`:
  - no `environment:` or `permissions:` (`:23-25`); floating pins at `:26`, `:28`;
  - render env at `:44-54`, with no VAPID or MTLS;
  - `do-inject-prod-secrets.py` call at `:60`;
  - the `DO_PROD_APP_ID` warning at `:106` and header at `:8-10`;
  - the `MCP_AGENT_SECRET` comment at `:47`.

**TDD**: `red-green required`

**Covers**: `AC-11, AC-22`

**Instructions**:
Add group `produp`. Assert on `.github/workflows/prod-up.yml`, after it parses (`yq e 'true'`):
- exactly 12 `LEGACY_*` lines, each equal to `LEGACY_<K>: ${{ secrets.PROD_<K> }}` or `LEGACY_PROJECT_ID: ${{ secrets.DO_PROD_PROJECT_ID }}`, with the name set equal to the do-target KEYS set;
- job `up` has `environment: production` and `permissions:` with `contents: read`;
- checkout and doctl are pinned to the SHAs in the pins table;
- the render step calls `scripts/do-render-app-spec.py` with `--env production --spec .do/app.yaml --app-name xstockstrat-production --out "$RUNNER_TEMP/app.yaml"`;
- `doctl apps create --spec "$RUNNER_TEMP/app.yaml"`;
- an `if: always()` step removes `$RUNNER_TEMP/app.yaml`;
- none of `do-inject-prod-secrets`, `DO_PROD_APP_ID`, `MCP_AGENT_SECRET` or an unprefixed `secrets.<common K>` occurs;
- `scripts/do-inject-prod-secrets.py` does not exist.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh produp   # RED before Step 12; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 12 — service: `prod-up.yml` on the unified renderer; delete `do-inject-prod-secrets.py`

**Status**: `done`
**Service**: `.github/workflows`
**Files**:
- `.github/workflows/prod-up.yml` — modify
- `scripts/do-inject-prod-secrets.py` — delete

**Reviewers**: Security — full key set at create (VAPID + mTLS), hard-fail on missing required; Platform Lead — prod-up behind the production reviewer gate

**Codebase Evidence**:
- `prod-up.yml:1-106` was read in full. The check step at `:32-40` is kept unchanged.
- `scripts/do-inject-prod-secrets.py` has exactly one caller (`prod-up.yml:60`; repo-wide grep over `.github/` and `scripts/`). It soft-warns on a missing required key at `:63-64`, which the design deliberately turns into a hard fail (design C5, design.md:132-135).
- This closes the `fails.md` L1095 trap surfaces: the reusable `deploy.yml` (Step 10), the callers (Step 10), `do-inject-prod-secrets.py` + `prod-up.yml` (this step), and `docs/setup/digitalocean.md` + `docs/runbooks/infra-cost-reduction.md` (Step 20).

**TDD**: `red-green required`

**Covers**: — (covered by Step 11; render behaviour by Step 7)

**Instructions**:
Per design C5 and § Per-workflow step order (design.md:123-135, :170):
- Job `up` gets `environment: production` and `permissions: {contents: read}`. Pin checkout and doctl.
- Keep the `check` step.
- Add `uses: ./.github/actions/setup-sops` with `if: steps.check.outputs.app_id == ''` (the same guard the existing create/assign/wait steps use).
- Replace `Render app spec with secrets` (`:42-60`) with the render step, guarded by `if: steps.check.outputs.app_id == ''`. Its `env` holds `SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}` plus the 12 literal-PROD `LEGACY_*` lines from Step 11. It runs `python3 scripts/do-render-app-spec.py --env production --spec .do/app.yaml --app-name xstockstrat-production --image-tag "${{ inputs.image_tag }}" --org "${{ github.repository_owner }}" --out "$RUNNER_TEMP/app.yaml"` with `id: render`.
- Create from `$RUNNER_TEMP/app.yaml`.
- Assign reads `DO_PROJECT_ID: ${{ steps.render.outputs.project_id }}`.
- Keep wait and report, but delete the `:106` `::warning::` line (the report still echoes the URL and app id).
- Add a final `if: always()` `rm -f "$RUNNER_TEMP/app.yaml"`.
- Rewrite header `:8-10` to say that deploys resolve the app by name, so nothing needs updating after a recreate.
- Drop the `:47` comment.
- `git rm scripts/do-inject-prod-secrets.py`.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh produp render
yq e 'true' .github/workflows/prod-up.yml >/dev/null
grep -rn --exclude=sops-secrets.test.sh "do-inject-prod-secrets" .github/ scripts/ ; test $? -eq 1
```

---

### Step 13 — test: Static rules for `deploy-homelab.yml`

**Status**: `done`
**Service**: `.github/workflows`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (group `homelab`)

**Reviewers**: Security — no 1Password; common-key fallbacks only via DEV_/PROD_ (FR-10)

**Codebase Evidence**:
- The homelab expected texts (14 lines) are at design.md:358-361.
- Today's 1Password surfaces: `deploy-homelab.yml:2` (header), `:37-39` (`OP_CLI_*` pins), `:103-175` (src / opcli / op / report). The fallbacks `steps.op.outputs.X || secrets.X` are at `:179`, `:189-190`, `:208`, `:219-220`.
- Job env at `:52-55`; the detach to the image commit at `:77`.

**TDD**: `red-green required`

**Covers**: `AC-12, AC-22`

**Instructions**:
Add group `homelab`. Assert on `.github/workflows/deploy-homelab.yml`, after it parses (`yq e 'true'`):
- AC-12 static, with two greps that must both return nothing:
  - case-sensitive `grep -nE '\bop\b|\bOP_'`, so `STOP_`, `--output-type` and `options` don't match;
  - case-insensitive `grep -niE '1password|load-secrets-action'`;
- exactly 14 `LEGACY_*` lines: the 9 homelab-targeted common keys in the `secrets[format('{0}_<K>', env.P)]` form, `LEGACY_<H>: ${{ secrets.<H> }}` for TS_AUTHKEY / DEPLOY_SSH_KEY / DEPLOY_KNOWN_HOSTS / APP_ENV, and `LEGACY_TS_AUTHKEY_EXPIRES: ${{ vars.TS_AUTHKEY_EXPIRES }}`, with the name set equal to the KEYS-derived homelab set;
- exactly one job-level `P:` line with the C6 text, and none at step level;
- no `secrets.MTLS_CA` or unprefixed `secrets.<common K>`;
- a `validate` job with no environment, which `deploy` `needs`;
- the line number of the `sops_secrets.py resolve` step is lower than that of the first `git checkout --quiet --detach` (resolve before detach);
- no `uses:` line after the resolve step.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh homelab   # RED before Step 14; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 14 — service: `deploy-homelab.yml` drops 1Password and resolves via SOPS

**Status**: `pending`
**Service**: `.github/workflows`
**Files**:
- `.github/workflows/deploy-homelab.yml` — modify

**Reviewers**: Security — GITHUB_ENV export (operator waiver), shared CA; Platform Lead — keep 279's gates and the `homelab-release-env.sh` contract

**Codebase Evidence**:
- `deploy-homelab.yml:1-249` was read in full. The step bodies to keep:
  - image-tag validation `:68-76` and the `IMAGE_TAG`/`SRC_SHA` export at `:81`;
  - the predates check `:77-80`; digests `:83-101`;
  - the expiry gate `:177-185`; release env `:187-193`; render check `:195-196`;
  - Tailscale `:198-204`; join `:206-215`; SSH `:217-229`; ship `:231-242`; leave `:244-249`.
- The `scripts/homelab-release-env.sh` contract (APP_ENV, MTLS_CA and TARGET_ENV from env, `:2`, `:13`) is unchanged.
- Operator waiver for the GITHUB_ENV export: context.md round-2 gate (accepted) and design C6 (design.md:142).

**TDD**: `red-green required`

**Covers**: — (covered by Step 13; resolve/render behaviour by Step 3)

**Instructions**:
Per design C6 and design.md:172-188:
- Rewrite the `:2` header: secrets come from `secrets/<env>.enc.yaml` (common + homelab), with per-key fallback to the DEV_/PROD_ repo secrets (common) and the same-named environment secrets (homelab).
- Delete the `OP_CLI_*` env (`:37-39`).
- Add a `validate` job (no environment) that checks `inputs.environment ∈ {staging, production}`. Add `needs: validate` to `deploy`.
- Add job `env` `P: ${{ inputs.environment == 'production' && 'PROD' || 'DEV' }}`.
- Steps in order:
  1. Pinned checkout with `fetch-depth: 0`.
  2. Validate the image tag: the `:68-76` body and the `:81` export, **without** the `git checkout --detach`.
  3. `uses: ./.github/actions/setup-sops`.
  4. Resolve: `env` holds `SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}` plus the 14 `LEGACY_*` lines (Step 13 text). Run `python3 scripts/sops_secrets.py resolve --env "$TARGET_ENV" --target homelab --github-env "$GITHUB_ENV"`.
  5. `git checkout --quiet --detach "$SRC_SHA"`, then the `:78-80` predates check.
  6. Digests.
  7. The expiry gate, reading `EXPIRES="$TS_AUTHKEY_EXPIRES"` with no `env:` block.
  8. Release env, with no `env:` block (APP_ENV and MTLS_CA come from GITHUB_ENV).
  9. Render check.
  10. Tailscale.
  11. Join and SSH, with no `env:` blocks.
  12. Ship.
  13. Leave.
- Delete `:103-175`.
- Keep concurrency, permissions and `timeout-minutes`.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh homelab resolve
yq e 'true' .github/workflows/deploy-homelab.yml >/dev/null
bash scripts/homelab-render.test.sh   # 279 contract unchanged
```

---

### Step 15 — test: Static rules for `sops-bootstrap.yml`, plus the `ac24` and `cleanup` groups

**Status**: `pending`
**Service**: `.github/workflows`
**Files**:
- `scripts/sops-secrets.test.sh` — modify (groups `bootstrap`, `ac24`, `cleanup`)

**Reviewers**: Security — matrix pinned, ciphertext-only artifact, GH_PAT required

**Codebase Evidence**:
- The bootstrap expected texts: design.md:362 (deploy.yml forms with `matrix.prefix`) and design.md:368 (matrix pinned).
- The PR mechanics to mirror: `sync-main-to-maindev.yml:20` (checkout token), `:22-25` (bot identity), `:36-40` (narrow refspec), `:62-72` (push retry), `:83` (`gh pr list --head`), `:100-112` (`gh pr create --base main-dev`).

**TDD**: `red-green required`

**Covers**: `AC-7, AC-22, AC-24`

**Instructions**:
Add group `bootstrap`. Assert on `.github/workflows/sops-bootstrap.yml`, after it parses (`yq e 'true'`):
- trigger `workflow_dispatch` with a boolean `force`; workflow `permissions: contents: read`;
- job `seed` matrix `include` is exactly `{environment: staging, prefix: DEV}` and `{environment: production, prefix: PROD}`, with `fail-fast: true` and `environment: ${{ matrix.environment }}`;
- exactly 12 `LEGACY_*` lines of the form `LEGACY_<K>: ${{ secrets[format('{0}_<K>', matrix.prefix)] }}` / `LEGACY_PROJECT_ID: ${{ secrets[format('DO_{0}_PROJECT_ID', matrix.prefix)] }}`;
- `SOPS_OPERATOR_AGE_RECIPIENT: ${{ vars.SOPS_OPERATOR_AGE_RECIPIENT }}`;
- upload-artifact is pinned to `cf430e03…` with `retention-days: 1`;
- job `pr` has `needs: seed`, fails on an empty `GH_PAT`, checks out `main-dev` with `GH_PAT`, pins download-artifact to `37930b1c…`, calls `scripts/sops_secrets.py sops-config`, pushes `chore/sops-bootstrap` with `--force-with-lease`, and runs `gh pr create --base main-dev` under `GH_TOKEN: ${{ secrets.GH_PAT }}`;
- no `git push` targets `main-dev` or `main` (F-02).

Add group `ac24` (AC-24):
- `grep -n MCP_AGENT_SECRET` over `scripts/do-render-app-spec.py`, `scripts/sops_secrets.py`,
  `.github/workflows/sops-bootstrap.yml`, `.github/workflows/deploy*.yml`, `.github/workflows/prod-up.yml`, `.do/app.yaml`,
  `.do/app.dev.yaml` and any existing `secrets/*.enc.yaml` returns nothing. This is the one deliberate read of the
  repo's real `secrets/`. It is a read-only grep of committed ciphertext files (SOPS keeps key names in plaintext), and it never
  decrypts, so it is hermetic in effect;
- `scripts/do-inject-prod-secrets.py` is absent.

It is RED today (`.do/app.yaml:381`, `.do/app.dev.yaml:383`) and GREEN after Step 17.

Add group `cleanup`:
- no `DO_(DEV|PROD)_APP_ID` in `.do/app.yaml`, `.do/app.dev.yaml` or `scripts/do-setup-check.sh`;
- `scripts/do-setup-check.sh` has `REQUIRED_SECRETS=(DIGITALOCEAN_ACCESS_TOKEN BUF_TOKEN)`;
- `sed -n 1,20p scripts/mtls-provision.sh | grep -q 'common\.MTLS_CA'`, and
  `! sed -n 1,20p scripts/mtls-provision.sh | grep -qiE 'separate CAs?|DEV_MTLS_CA / PROD_MTLS_CA'`. Both are RED today (`:4-12`).

It is RED before Step 17 and GREEN after.

**Verification**:
```bash
bash scripts/sops-secrets.test.sh bootstrap   # RED before Step 16; GREEN after
bash scripts/sops-secrets.test.sh ac24 cleanup   # RED before Step 17; GREEN after
shellcheck scripts/sops-secrets.test.sh && shfmt -d -i 2 scripts/sops-secrets.test.sh
```
`scripts/` has no CI coverage threshold (`docs/patterns/ci-overview.md`). The hermetic suite is the verification.

---

### Step 16 — service: New `sops-bootstrap.yml`

**Status**: `pending`
**Service**: `.github/workflows`
**Files**:
- `.github/workflows/sops-bootstrap.yml` — create
- `.gitleaks.toml` — modify (**conditional**, design Risk 5: only when gitleaks flags the age armor or recipients; path-scoped allowlist for `secrets/*.enc.yaml` and `.sops.yaml`)

**Reviewers**: Security — one-shot seeding from effective values, refuse overwrite without force; Platform Lead — PR to main-dev only

**Codebase Evidence**:
- **Not found**: no workflow today creates a branch and commit and opens a PR from scratch (recon § Risks). The closest pattern is `sync-main-to-maindev.yml:15-112` (cited lines in Step 15).
- Design C7 + § Per-workflow step order: design.md:145-149 and :190-208.
- `build`/`sops-config` come from Step 6.

**TDD**: `red-green required`

**Covers**: — (covered by Step 15; build behaviour by Step 5)

**Instructions**:
Create the workflow per design.md:190-208.

**Job `seed`** (matrix as in Step 15; `runs-on: ubuntu-24.04`):
1. Pinned checkout, default credentials.
2. setup-sops.
3. Build step: `env` holds `SOPS_AGE_KEY`, `SOPS_OPERATOR_AGE_RECIPIENT` and the 12 `LEGACY_*` lines. Run with `FORCE: ${{ inputs.force }}` mapped into the shell, `python3 scripts/sops_secrets.py build --env "${{ matrix.environment }}" --out "$RUNNER_TEMP/out" ${force_flag}`, where `force_flag=--force` only when `FORCE` is `true`.
4. Pinned upload-artifact `name: sops-${{ matrix.environment }}`, `path: ${{ runner.temp }}/out`, `retention-days: 1`.

**Job `pr`** (`needs: seed`):
1. `[ -n "$GH_PAT" ] || { echo "::error::GH_PAT is required: a GITHUB_TOKEN PR runs no CI"; exit 1; }`.
2. Pinned checkout `ref: main-dev`, `token: ${{ secrets.GH_PAT }}`, `fetch-depth: 0`.
3. Pinned download-artifact `pattern: sops-*`, `merge-multiple: true`, into `$RUNNER_TEMP/out`.
4. `mkdir -p secrets && cp "$RUNNER_TEMP/out/"*.enc.yaml secrets/`.
5. `python3 scripts/sops_secrets.py sops-config "$RUNNER_TEMP/out" >.sops.yaml`, with `SOPS_OPERATOR_AGE_RECIPIENT` from vars.
6. Bot identity.
7. `git fetch origin '+refs/heads/chore/sops-bootstrap:refs/remotes/origin/chore/sops-bootstrap' || true`, then `git checkout -B chore/sops-bootstrap`, `git add .sops.yaml secrets/`, and commit.
8. `git push --force-with-lease origin chore/sops-bootstrap` with the `:62-72` retry shape.
9. `gh pr list --head chore/sops-bootstrap --base main-dev --state open`. If a PR exists, `gh pr edit`; otherwise `gh pr create --base main-dev --head chore/sops-bootstrap`. The body is the concatenated `*.changes.md` files, or "initial seed" when there are none.

A failed `seed` skips `pr` by default `needs` semantics, so nothing is pushed.

**gitleaks (design Risk 5):** after the step is green, run `gitleaks detect --no-git --source .github/workflows/sops-bootstrap.yml` and the same on a Step 5 test output file when gitleaks is available locally. If it flags the age armor or the recipients, add a path-scoped allowlist entry to the existing `.gitleaks.toml` for `secrets/*.enc.yaml` / `.sops.yaml` only (the conditional file above).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh bootstrap build
yq e 'true' .github/workflows/sops-bootstrap.yml >/dev/null
grep -nE "git push.*(main-dev|main)\b" .github/workflows/sops-bootstrap.yml ; test $? -eq 1
```

---

### Step 17 — service: Comment and secret-name cleanup in scripts and app specs

**Status**: `pending`
**Service**: `scripts/`, `.do/`
**Files**:
- `.do/app.yaml` — modify (comments `:1-4`, `:381-382`)
- `.do/app.dev.yaml` — modify (comments `:1-4`, `:383-384`)
- `scripts/do-setup-check.sh` — modify (`:111`)
- `scripts/mtls-provision.sh` — modify (header `:4-12`, `set-secret` usage/echo text `:18`, `:128`)

**Reviewers**: Platform Lead — setup-check secret list

**Codebase Evidence**:
- `.do/app.yaml:2-4` and `.do/app.dev.yaml:2-4` tell the operator to set `DO_{PROD,DEV}_PROJECT_ID` in GitHub Secrets and to find `DO_{PROD,DEV}_APP_ID`.
- `.do/app.yaml:381` and `.do/app.dev.yaml:383` hold `(MCP_AGENT_SECRET` (spec-time finding 1).
- `scripts/do-setup-check.sh:111` is `REQUIRED_SECRETS=(DIGITALOCEAN_ACCESS_TOKEN DO_DEV_APP_ID DO_PROD_APP_ID BUF_TOKEN)`.
- `scripts/mtls-provision.sh:4-12` (the "SEPARATE CAs" and `DEV_MTLS_CA / PROD_MTLS_CA` narrative), `:18` (usage) and `:125-128` (`gh secret set`).

**TDD**: `red-green required` (covered by Step 15's `ac24` and `cleanup` groups)

**Covers**: — (covered by Step 15; makes AC-24 green)

**Instructions**:
- **`.do/` headers.** In both specs, change `:2-4` to say the project ID lives in `secrets/<env>.enc.yaml` `digitalocean.PROJECT_ID` (legacy `DO_*_PROJECT_ID` fallback), and that deploys find the app by its `name:`. Drop the APP_ID line.
- **`.do/` agent comment.** Reword the agent comment to "the agent HMAC-signs its OAuth txn blob with JWT_SECRET; same shared platform JWT secret as identity/ui", without naming the retired secret.
- **`do-setup-check.sh`.** Change `:111` to `REQUIRED_SECRETS=(DIGITALOCEAN_ACCESS_TOKEN BUF_TOKEN)`.
- **`mtls-provision.sh` header.** Say the CA is `common.MTLS_CA` in `secrets/<env>.enc.yaml`, shared by DO and homelab (FR-10). `set-secret` still writes the legacy `DEV_/PROD_MTLS_CA` repo secret, which the deploy reads only as a fallback; for SOPS, use `ca <dev|prod>` and `sops set`. The script's behaviour does not change.

**Verification**:
```bash
grep -n MCP_AGENT_SECRET .do/app.yaml .do/app.dev.yaml ; test $? -eq 1
grep -nE "DO_(DEV|PROD)_APP_ID" .do/app.yaml .do/app.dev.yaml scripts/do-setup-check.sh ; test $? -eq 1
shellcheck scripts/do-setup-check.sh scripts/mtls-provision.sh && shfmt -d -i 2 scripts/do-setup-check.sh scripts/mtls-provision.sh
bash scripts/sops-secrets.test.sh ac24 cleanup render   # GREEN
```

---

### Step 18 — config: CI job `sops-secrets`, `sops` filter, ci-gate; `.gitignore`

**Status**: `pending`
**Service**: `.github/workflows` (CI harness)
**Files**:
- `.github/workflows/ci.yml` — modify
- `.gitignore` — modify

**Reviewers**: Platform Lead — CI gate completeness

**Codebase Evidence**:
- paths-filter block: `ci.yml:39-118`. The `ci` key is at `:40-41`, `scripts` at `:67-69`, and `homelab` at `:80-85` (it already covers `deploy/homelab/**`, `scripts/homelab-*`, `gen-dev-certs.sh`, `mtls-provision.sh`, `deploy-homelab.yml`).
- Job shape to copy: `homelab-render` at `ci.yml:897-908` (ubuntu-24.04, filter-gated, no setup actions).
- ruff install pattern: `ci.yml:349-356` (`pip install ruff`, `ruff check`, `ruff format --check`).
- ci-gate: job at `ci.yml:930`, the `needs` list at `:933-953` and the echo lines at `:958-977`.
- shell-lint already globs `scripts/*.sh` (`ci.yml:653-657`), so it lints the new test file with no change.
- `.gitignore:54-61` lists the secret file types. `git check-ignore` confirms that `secrets/staging.enc.yaml` and `.sops.yaml` are **not** ignored (the `secrets.*` rule at `:59` does not match the directory layout), and that `keys.txt` / `*.agekey` are not ignored either (the entries must be added).
- AC-24 surfaces: today `MCP_AGENT_SECRET` appears at `prod-up.yml:47` (removed in Step 12), `.do/app.yaml:381` and `.do/app.dev.yaml:383` (removed in Step 17), and `scripts/do-inject-prod-secrets.py:19` (deleted in Step 12).

**TDD**: `N/A (CI wiring; the job's first run is the verification)`

**Covers**: — (runs every group in CI, including Step 15's `ac24` for AC-24)

**Instructions**:
1. **Filter.** Add a filter key `sops:` with `'scripts/sops_secrets.py'`, `'scripts/do-render-app-spec.py'`, `'scripts/sops-secrets.test.sh'`, `'.github/actions/setup-sops/**'`, `'.github/workflows/deploy*.yml'`, `'.github/workflows/prod-up.yml'`, `'.github/workflows/sops-bootstrap.yml'`, `'.do/**'`, `'.sops.yaml'` and `'secrets/**'`.
2. **Job `sops-secrets`.** Add a job (`needs: changes`; `if:` matches `sops` || `homelab` || `ci`; `runs-on: ubuntu-24.04`). Steps:
   - `actions/checkout@v7` (the file-wide convention);
   - `uses: ./.github/actions/setup-sops`;
   - `python3 -m pip install ruff`;
   - `ruff check scripts/sops_secrets.py scripts/do-render-app-spec.py` and `ruff format --check` on the same files;
   - `bash scripts/sops-secrets.test.sh`.
3. **Gate.** Add `sops-secrets` to the ci-gate `needs` and add its echo line. Features 278 and 281 also append there, so the second to land rebases and keeps every entry (spec-time finding 6).
4. **`.gitignore`.** Append `*.agekey` and `keys.txt` under the secret-file-types block (`:54-61`).

**Verification**:
```bash
bash scripts/sops-secrets.test.sh            # all groups green 
git check-ignore -q --no-index keys.txt && git check-ignore -q --no-index x.agekey && ! git check-ignore -q --no-index secrets/staging.enc.yaml && ! git check-ignore -q --no-index .sops.yaml
grep -n "sops-secrets" .github/workflows/ci.yml   # filter key, job, gate needs, gate echo
```
Then the PR's CI run shows `sops-secrets` passing and `CI Gate` green.

---

### Step 19 — docs: Operator runbook `docs/runbooks/sops-secrets.md`

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/sops-secrets.md` — create
- `docs/runbooks/CLAUDE.md` — modify (index row)

**Reviewers**: none

**Codebase Evidence**:
- The index table is at `docs/runbooks/CLAUDE.md:5-` (`| File | Purpose | Key trigger |`).
- Content sources: design.md § Rollout (:210-246), § Places to touch per new secret (:248-255), Open Risks 3/4/6/8 (:398-403), and context.md § Open Threads.
- macOS rule: root `CLAUDE.md` § Language Versions (brew first, no `grep -P`, `python3 -m pip`).

**TDD**: `N/A (docs)`

**Covers**: `AC-14`

**Instructions**:
Write sections, in order:
1. **Key generation:** `brew install sops age`, plus a Linux alternative; `age-keygen -o` for staging, production and operator; key files kept outside the repo (`*.agekey` / `keys.txt` are now ignored).
2. **Environment setup:** `gh secret set SOPS_AGE_KEY --env staging|production`, `gh variable set SOPS_OPERATOR_AGE_RECIPIENT`, and the design's preflight list (rollout step 2).
3. **Bootstrap:** dispatch from `main`, `force`, the production reviewer pause, and reading the PR body.
4. **Local edit:** `SOPS_AGE_KEY_FILE=… sops secrets/<env>.enc.yaml`.
5. **Rotation:** `sops set`; then the `sops (differs from legacy)` warning, plus re-bootstrap with `force=true` when a legacy secret was rotated between bootstrap and merge.
6. **Adding a key:** the four steady-state touch points.
7. **Homelab enablement:** `sops set` for `homelab.*` and `homelab.app_env` before enabling (Risk 6); a common value containing a newline is refused for homelab (Risk 4); the trailing-newline check (Risk 3).
8. **Legacy-secret removal:** a follow-up, once every key reports `sops` in both environments; also delete `DO_*_APP_ID`, `OP_*` and the 1Password items.
9. **The production reviewer gate:** every prod deploy and prod-up waits for it (Risk 8).

Every command must be macOS-compatible. Add an index row to `docs/runbooks/CLAUDE.md`.

**Verification**:
```bash
for s in "Key generation" "Environment setup" "Bootstrap" "Local edit" "Rotation" "Adding a key" "Legacy-secret removal"; do grep -q "^## .*$s" docs/runbooks/sops-secrets.md || echo "missing: $s"; done
grep -n "brew install sops age" docs/runbooks/sops-secrets.md && grep -n "sops-secrets.md" docs/runbooks/CLAUDE.md
! grep -nE "grep -P|^\s*pip " docs/runbooks/sops-secrets.md
```

---

### Step 20 — docs: Docs sweep of the `docs/` tree (legacy secret names, CA location, deploy wiring)

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/setup/digitalocean.md` — modify (`:48`, `:55`, `:238`, `:276`, `:368-369`, `:385`, `:400-403`, `:463-464`, `:477-509` secrets table, `:526-531`, `:564-579`)
- `docs/runbooks/infra-cost-reduction.md` — modify (`:53-71`)
- `docs/patterns/inter-service-mtls.md` — modify (`:97`, `:104-106`, the unified CA, FR-10)
- `docs/runbooks/inter-service-mtls-rollout.md` — modify (`:38-43`, `:66`)
- `docs/patterns/ci-overview.md` — modify (`:51-52`, plus a `sops-secrets` job row in the CI matrix)
- `docs/runbooks/feature-workflow.md` — modify (`:204`, `:239`)
- `docs/runbooks/add-data-source.md` — modify (`:91` row 8, plus any sibling rows naming the deploy passthrough)
- `docs/setup/grafana-cloud.md` — modify (`:169`, `:177`)
- `docs/launch-pdfs/infra-ci.md` — modify (`:188`, `:199`, `:324`)

**Reviewers**: none

**Codebase Evidence**:
- Every line above was confirmed by a spec-time grep for `DO_(DEV|PROD)_APP_ID|DEV_MTLS_CA|PROD_MTLS_CA|do-inject-prod-secrets|DEV_JWT_SECRET|PROD_JWT_SECRET|separate CA` (2026-11-04). Examples:
  - `docs/patterns/inter-service-mtls.md:105`: "(GitHub environment secret or 1Password `mtls-ca`; a separate CA from DO's)"
  - `docs/runbooks/infra-cost-reduction.md:53` (stale `PROD_ALPACA_API_KEY`), `:59` (`do-inject-prod-secrets.py`), `:66-70` (stale `DO_PROD_APP_ID`)
  - `docs/patterns/ci-overview.md:52` (`DO_APP_ID`)
- These are the `fails.md` L1095 doc surfaces (the `docs/setup/digitalocean.md` secrets table and the `docs/runbooks/infra-cost-reduction.md` bring-up list).
- Deliberately out of scope:
  - `docs/repo-surveyor/feature-gap-findings.md` (a dated point-in-time report);
  - `docs/sdd/business-rules/platform.feature` (`docs/sdd/business-rules/CLAUDE.md:51` forbids hand-editing it; @AC-24 is promoted at launch);
  - `docs/roadmap/**` history.
- Line numbers are spec-time. The executor re-greps with the Verification pattern and edits the lines it finds; the grep, not the numbers, is authoritative.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
For each surface, replace the legacy wiring with the SOPS model:
- Values are in `secrets/<env>.enc.yaml` (`common.<K>`, `digitalocean.PROJECT_ID`, `homelab.*`).
- During the transition, the per-key fallback reads the `DEV_*`/`PROD_*` repo secrets (homelab-only keys read the environment secrets).
- The DO app is found by spec name, so `DO_*_APP_ID` is no longer set.
- prod-up injects the full key set via `scripts/do-render-app-spec.py`.
- One `MTLS_CA` per environment is shared by DO and homelab. This reverses `inter-service-mtls.md:105`; say so in one sentence.

In `docs/setup/digitalocean.md`, rebuild the secrets table:
- drop the stale ALPACA/FMP/FINNHUB rows;
- add the missing CONFIG/VAPID/OTEL/MTLS rows;
- mark the legacy rows as fallback-only;
- add `SOPS_AGE_KEY` (env secret) and `SOPS_OPERATOR_AGE_RECIPIENT` (repo var).

Link `docs/runbooks/sops-secrets.md` from `digitalocean.md`, `infra-cost-reduction.md` and `inter-service-mtls.md`. Feature 281 also adds a row to the `ci-overview.md` CI table; keep both rows if it lands first (spec-time finding 6). Keep each edit surgical (How to Act #3).

**Verification**:
```bash
grep -rnE "DO_(DEV|PROD)_APP_ID|do-inject-prod-secrets|1Password .mtls-ca|separate CA from DO" docs/setup docs/runbooks docs/patterns docs/launch-pdfs
# expect: only lines that explicitly describe the legacy fallback / follow-up removal
npx --yes markdownlint-cli2 docs/runbooks/sops-secrets.md docs/setup/digitalocean.md docs/runbooks/infra-cost-reduction.md docs/patterns/inter-service-mtls.md docs/patterns/ci-overview.md
```

---

### Step 21 — docs: Remaining surfaces (env example, setup script comments, skill, service docs) + CLAUDE.md teardown

**Status**: `pending`
**Service**: repo root, `scripts/`, `.claude/skills/`, service docs
**Files**:
- `.env.example` — modify (comments `:99-100`)
- `scripts/setup-env.sh` — modify (comments `:293-294`)
- `.claude/skills/digitalocean-setup/SKILL.md` — modify (`:233`, `:596-597`, `:610-611`, `:663`)
- `services/xstockstrat-identity/CLAUDE.md` — modify (`:99`)
- `services/xstockstrat-identity/docs/operations.md` — modify (`:32-33`)
- `services/xstockstrat-notify/CLAUDE.md` — modify (`:130`)

**Reviewers**: none

**Codebase Evidence**:
- Same spec-time grep as Step 20. Line numbers are spec-time; the Verification grep is authoritative.
- The teardown rule: root `CLAUDE.md` § Teardown (it applies because Steps 20–21 change context files and documented behaviour).

**TDD**: `N/A (docs/comments)`

**Covers**: —

**Instructions**:
Apply the Step 20 SOPS-model wording to each surface:
- the skill's `gh secret set DO_*_APP_ID` / `DEV_/PROD_MTLS_CA` steps become `SOPS_AGE_KEY` environment secrets plus `sops set`, with the legacy secrets noted as fallback-only;
- `.env.example` and `setup-env.sh` comment tables drop `DO_*_APP_ID`;
- the identity docs name `common.JWT_SECRET` in `secrets/<env>.enc.yaml` (legacy `DEV_/PROD_JWT_SECRET` fallback);
- the notify doc names the new renderer instead of `do-inject-prod-secrets.py`.

Link the runbook from the identity and notify docs.

Then run the CLAUDE.md teardown: `/context-forge:context-constitution refresh`, scoped to every context file touched in Steps 19–21. If the plugin is unavailable, do the manual reconciliation described in root `CLAUDE.md` § Teardown and record it in the PR body.

**Verification**:
```bash
grep -nE "DO_(DEV|PROD)_APP_ID|do-inject-prod-secrets|DEV_MTLS_CA|PROD_MTLS_CA" .env.example scripts/setup-env.sh .claude/skills/digitalocean-setup/SKILL.md services/xstockstrat-identity/CLAUDE.md services/xstockstrat-identity/docs/operations.md services/xstockstrat-notify/CLAUDE.md
# expect: only lines that explicitly describe the legacy fallback / follow-up removal
shellcheck scripts/setup-env.sh && shfmt -d -i 2 scripts/setup-env.sh
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### D-1 — Step 1/5: AC-1 wrong-key stderr wording
- **Spec said**: decrypting with the other env's key fails with stderr containing `no matching keys` (AC-1, Step 1 item 3, Step 5 case 2).
- **Actual**: sops 3.13.3 prints `Failed to get the data key required to decrypt the SOPS file … identity did not match any of the recipients`.
- **Disposition**: Step 1 item 3 pre-authorised asserting the recorded text. Step 5 asserts `identity did not match any of the recipients`. The intent of AC-1's Then (refused, no value printed) is unchanged. The acceptance.feature wording is reconciled at C-16 promotion (ALL-DONE 2.5) to the real sops text.
