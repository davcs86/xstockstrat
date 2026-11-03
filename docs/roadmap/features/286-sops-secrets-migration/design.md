# Design: sops-secrets-migration

**Feature**: 286-sops-secrets-migration
**Created**: 2026-11-03
**Mode**: full debate (rounds 1–4)
**Inputs**: recon.md, product-spec.md (FR-1..FR-11), acceptance.feature (@AC-1..@AC-24; @AC-3/4/19 retired), context.md

---

## Chosen Approach

There is one KEYS table, in stdlib-only `scripts/sops_secrets.py`, and it is used three ways:

- **DO:** `scripts/do-render-app-spec.py` imports it as a library, so resolve and render happen in one process and no DO secret is written to `GITHUB_ENV`.
- **Homelab:** `scripts/sops_secrets.py resolve` runs once as a CLI, before the image-commit detach.
- **Bootstrap:** `scripts/sops_secrets.py build` runs, owning the force guard and the self-verify.

Legacy fallbacks reach the resolver only as `LEGACY_<NAME>` step env vars. The right-hand side of each one is pinned by a static test (AC-22).

### C1 `scripts/sops_secrets.py` (new)

**KEYS** — tuples of `(ns, name, required, targets)`:

| Namespace | Keys | Required | Targets |
|---|---|---|---|
| common | JWT_SECRET, BROKER_ACCOUNTS_ENCRYPTION_KEY, CONFIG_SECRETS_ENCRYPTION_KEY | R | do + homelab |
| common | MTLS_CA | R | do (minted) + homelab (passed as `MTLS_CA`, never in the APP_ENV tail) |
| common | SLACK_WEBHOOK_URL, SENDGRID_API_KEY, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT | O | do + homelab |
| common | OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS | O | do only (compose hardcodes OTEL off, `deploy/homelab/compose.yml:7`) |
| digitalocean | PROJECT_ID | O | do |
| homelab | TS_AUTHKEY, TS_AUTHKEY_EXPIRES, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, `app_env` (map) | R at deploy | homelab |

**`resolve(env, target, file=None)`**

- `env` must be `staging` or `production`. The file is `<repo>/secrets/<env>.enc.yaml`, resolved relative to `__file__`, which always means the workflow commit's file.
- **File absent:** every key falls back to `LEGACY_<NAME>`, with source `github`.
- **File present but `SOPS_AGE_KEY` empty:** hard fail.
- **Decrypt:** runs `sops decrypt --output-type json`. sops stderr is dropped and replaced by a fixed message: `cannot decrypt secrets/<env>.enc.yaml (sops exit N)`. An undecryptable file never falls back per key.
- **Non-string leaf:** fails with `<ns>.<K> must be a string`.
- **Masking comes first.** It emits `::add-mask::` for every line and for the whole value, for every value of 4 characters or more. The floor is documented: shorter values are non-secret flags, and masking them would blank unrelated log text.
- **Both stores present with different SHA-256:** the source is reported as `sops (differs from legacy)`, plus a `::warning::` naming the key.
- **Summary:** writes `### Secret sources` with one `- K: sops|github|MISSING` line per key. This reuses the shape at `deploy-homelab.yml:153-175`.
- **Required key missing:** `K is in neither SOPS nor the GitHub secrets`, exit 1. Errors name keys only.
- **No normalisation:** values pass through exactly as stored. Presence means `!= ''`. No strip, no newline changes.

**CLI `resolve --env E --target homelab --github-env PATH`**

It writes TS_AUTHKEY, TS_AUTHKEY_EXPIRES, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, MTLS_CA and APP_ENV as `NAME<<ghadelim_<uuid4>` heredocs, each in the form value + one `\n` + delimiter. A value containing the delimiter is refused.

APP_ENV is built as a body plus a common tail, in both branches:

- **Body when SOPS has `homelab.app_env`:** one `K='V'` line per entry.
  - The key must match `^[A-Za-z_][A-Za-z0-9_]*$`.
  - A value containing `'` or a newline is refused, and the error names the key.
  - A common key is refused with `homelab.app_env must not contain common key K` (@AC-23).
- **Body otherwise:** the `LEGACY_APP_ENV` blob, minus lines matching `^\s*(?:export\s+)?(?:<11 common names>)\s*[=:]`. This mirrors the `owned` regex at `homelab-release-env.sh:34`.
- **Tail, written last so DO wins:** the 8 homelab-targeted common app keys (JWT, BROKER, CONFIG, SLACK, SENDGRID, VAPID×3) as `K='V'`, under the same refusal rules.

Keys in the `owned` set are not rejected, because `homelab-release-env.sh:34-36` already strips and overrides them.

**CLI `build --env E --out DIR [--force]`**

1. Masks every `LEGACY_*` value.
2. **Guard:**
   - Runs `git fetch --depth=1 origin main-dev`. A non-zero exit fails with `cannot fetch main-dev`; it never counts as "absent".
   - Runs `git ls-tree --name-only FETCH_HEAD -- secrets/E.enc.yaml`.
   - If the file is present and `--force` is not set, fails with `secrets/E.enc.yaml already exists; re-run with force=true to overwrite` (@AC-15).
3. **Required check:** fails with `K is required but missing`.
4. **Env recipient:** `age-keygen -y`, with `SOPS_AGE_KEY` on stdin.
5. **Encrypt:**
   - Pipes `json.dumps({"common":…, "digitalocean":…})` to `sops encrypt --input-type json --output-type yaml --filename-override secrets/E.enc.yaml --age <env>,<SOPS_OPERATOR_AGE_RECIPIENT>`.
   - Runs with `cwd=$RUNNER_TEMP` so the repo `.sops.yaml` is not picked up.
   - Writes `DIR/E.enc.yaml`.
6. **Self-verify:** decrypts the output and checks that:
   - the top-level keys are exactly {common, digitalocean};
   - every value is a string (`isinstance(str)`);
   - the key set and per-value SHA-256 match the sources;
   - every leaf starts with `ENC[AES256_GCM,`;
   - `sops.age` has exactly 2 recipients.
7. Writes `DIR/E.recipient`.
8. **On `--force`:** decrypts the FETCH_HEAD file and writes `DIR/E.changes.md`, listing keys as added / changed / unchanged / removed by hash comparison. Names only.

Plaintext never touches disk.

**Import rule:** `sys.path.insert(0, dirname(abspath(__file__)))`. Never invoke these entry points with `python3 -I`.

### C2 `scripts/do-render-app-spec.py`

New. It replaces `scripts/do-inject-prod-secrets.py` (deleted) and the inline python at `deploy.yml:118-198`.

Arguments: `--env E --spec PATH --app-name N --image-tag T --org O --out PATH`.

1. Asserts the spec's top-level `^name:` equals N (`.do/app.yaml:5`, `.do/app.dev.yaml:5`).
2. Absorbs the `YOUR_GITHUB_ORG` / `YOUR_IMAGE_TAG` sed (`deploy.yml:118-121`, `prod-up.yml:56-59`).
3. Calls `sops_secrets.resolve(env, "do")`.
4. Replaces `YOUR_{DEV,PROD}_<NAME>` for every do-target KEYS entry. The placeholder names are derived from KEYS.
5. Writes `''` for an absent optional key (`deploy.yml:142-164`). For prod-up this is a parity fix.
6. Keeps the OTEL `Authorization=` prefix rule (`deploy.yml:161-162`).
7. Mints mTLS in-process:
   - in a 0700 temp dir;
   - via `mtls-provision.sh decode-ca`, with `MTLS_CA` only in that subprocess's env (`mtls-provision.sh:72-94`), then `gen-dev-certs.sh`;
   - masks every `yaml_pem(...)` string (CA, leaf certs, leaf keys) before replacing it, reusing `yaml_pem` from `deploy.yml:177-183`.
8. Runs the MTLS leftover check (`deploy.yml:193-196`) and a global "no `YOUR_(DEV|PROD)_` remains" check.
9. Deletes the temp dir, and writes the spec with mode 0600 to `--out`, never to stdout.
10. Writes the non-secret `app_name` and `project_id` to `GITHUB_OUTPUT`.

### C3 `.github/actions/setup-sops/action.yml` (new composite)

- Pins `SOPS_VERSION`/`SOPS_SHA256` and `AGE_VERSION`/`AGE_SHA256`.
- Installs with `curl -fsSLO` → `sha256sum -c -` → `sudo install -m 0755` (`deploy-homelab.yml:198-204`).
- Contains no third-party `uses:`.
- Has 5 consumers: deploy.yml, prod-up.yml, deploy-homelab.yml, sops-bootstrap.yml and ci.yml.

### C4 `.github/workflows/deploy.yml` (rewritten)

- **Inputs:** `environment` (`type: string`, `required: true`; staging|production, checked by the validate job via `env: E: ${{ inputs.environment }}`), `app_spec`, `image_tag`.
- **Secrets block deleted:** the whole `secrets:` block (`:14-75`) goes, including `DO_APP_ID` (`:17`, used at `:203/:213/:220`).
- **Callers:**
  - `deploy-dev.yml:43-64` and `deploy-prod.yml:42-63` replace the 14-line passthrough with `secrets: inherit` + `with: {environment, app_spec, image_tag}`.
  - The homelab caller jobs and their `vars.HOMELAB_STAGING_ENABLED`/`vars.HOMELAB_PRODUCTION_ENABLED` gates (`deploy-dev.yml:66-74`, `deploy-prod.yml:65-73`) are untouched.
- **Why `format()`:** fallbacks use `secrets[format('{0}_<K>', env.P)]`, not `&&`/`||` on secrets. `cond && secrets.PROD_X || secrets.DEV_X` falls through to DEV when PROD_X is empty. `P`'s own `&&`/`||` is safe because both operands are non-empty literals.

### C5 `.github/workflows/prod-up.yml`

- **Job `up`:** `environment: production`, `permissions: contents: read`, and SHA-pinned checkout and doctl (currently floating tags, `:26`, `:28`).
- **Check step:** `:32-40` is unchanged.
- **Render:** the C2 command with `--env production --spec .do/app.yaml --app-name xstockstrat-production --out $RUNNER_TEMP/app.yaml`, run only when the app is absent.
  - Its `LEGACY_*` lines read literal `PROD_*` / `DO_PROD_PROJECT_ID` (12 lines, including `PROD_MTLS_CA`).
  - Project assignment reads the render output.
  - An `if: always()` step removes the rendered spec.
- **Deletions:** the `:106` warning goes, the `:8-10` header is rewritten, and the `MCP_AGENT_SECRET` comment at `:47` is dropped.
- **Deliberate behaviour changes:**
  - A missing required key hard-fails (it was a warning at `do-inject-prod-secrets.py:63-64`).
  - MTLS is now required and minted.
  - An absent optional key becomes `''`; it used to leave the literal placeholder.

### C6 `.github/workflows/deploy-homelab.yml`

- Adds a `validate` job (no environment) that `deploy` needs.
- The job `env` (`:52-55`) gains `P: ${{ inputs.environment == 'production' && 'PROD' || 'DEV' }}`.
- 1Password is removed entirely (`:103-175`, plus the `OP_CLI_*` pins at `:37-39`), and the `:2` header is rewritten.
- The `GITHUB_ENV` export of the 6 homelab values is accepted (operator waiver, context.md).
- A rollback uses the current tooling and current secrets. Only `compose.yml` and the release/render-check scripts come from the image commit.

### C7 `.github/workflows/sops-bootstrap.yml` (new)

- Triggered by `workflow_dispatch`, with a `force` boolean.
- `permissions: contents: read`.
- Has two jobs, `seed` (matrix) and `pr` (needs `seed`).

## Per-workflow step order

**deploy.yml**

- **job `validate`** (no environment): `case "$E" in staging|production) ;; *) ::error:: exit 1;; esac`
- **job `deploy`:** needs validate; `environment: ${{ inputs.environment }}`; `permissions: {contents: read}`; env `P` (as in C6) and `APP_NAME: xstockstrat-${{ inputs.environment }}`.
  1. Checkout, pinned to `3d3c42e5…` v7.0.1 (`deploy-homelab.yml:60`).
  2. doctl, SHA-pinned, using `secrets.DIGITALOCEAN_ACCESS_TOKEN`.
  3. **Resolve app ID:**
     - `awk -v n="$APP_NAME"` on `ID,Spec.Name` (`prod-up.yml:35-36`).
     - Exactly one match is required, otherwise `expected exactly 1 app named $N, found $n`.
     - Writes `APP_ID` to `GITHUB_ENV`, and `app: N → ID` to the summary.
  4. setup-sops.
  5. **Render** (`id: render`): env `SOPS_AGE_KEY` plus 12 `LEGACY_*` lines; output `$RUNNER_TEMP/app.yaml`.
  6. `doctl apps update "$APP_ID" --spec "$RUNNER_TEMP/app.yaml" --update-sources`.
  7. Project assign (`continue-on-error` kept) from `steps.render.outputs.project_id`.
  8. Wait on `$APP_ID`.
  9. `if: always()`: remove the spec.

**prod-up.yml (`up`):** pinned checkout → pinned doctl → check → [absent] setup-sops → [absent] render → create → assign → wait → report → `if: always()` rm.

**deploy-homelab.yml (`deploy`, needs validate):**

1. Pinned checkout, `fetch-depth: 0`. At this point the workspace is the workflow commit.
2. Validate the image tag (production runs only from main), using the body of `:68-76` and the `:81` `IMAGE_TAG`/`SRC_SHA` export, but without the checkout.
3. setup-sops.
4. **Resolve:** env `SOPS_AGE_KEY` plus 14 `LEGACY_*` lines; runs `python3 scripts/sops_secrets.py resolve --env "$TARGET_ENV" --target homelab --github-env "$GITHUB_ENV"`.
5. `git checkout --quiet --detach "$SRC_SHA"`, then the predates check (`:77-80`).
6. Digests (`:83-101`).
7. Expiry gate (`:177-185`), now reading the exported `$TS_AUTHKEY_EXPIRES`.
8. Release env (`:187-193`).
9. Render check.
10. Tailscale.
11. Join and SSH (`:206-229`).
12. Ship.
13. Leave.

Steps 7, 8 and 11 lose their `env:` blocks. No `uses:` runs after step 4.

**sops-bootstrap.yml**

- **`seed`:**
  - **Matrix:** exactly `{environment: staging, prefix: DEV}` and `{environment: production, prefix: PROD}`, with `fail-fast: true` and `environment: ${{ matrix.environment }}`. The production job waits for its reviewers.
  - Pinned checkout, with default credentials for the guard fetch.
  - setup-sops.
  - `build --env … --out $RUNNER_TEMP/out ${force:+--force}`, with 12 `LEGACY_*` lines, `SOPS_AGE_KEY` and `SOPS_OPERATOR_AGE_RECIPIENT: ${{ vars.SOPS_OPERATOR_AGE_RECIPIENT }}`.
  - SHA-pinned `upload-artifact`, 1-day retention. The artifact holds ciphertext, the recipient and the names-only changes list.
- **`pr`:**
  1. Fails if `GH_PAT` is empty.
  2. Checks out main-dev with `GH_PAT` (`sync-main-to-maindev.yml:20`).
  3. Downloads the artifacts.
  4. Writes `.sops.yaml` with two `creation_rules`: `path_regex: secrets/<env>\.enc\.yaml$`, `age: <env_pub>,<operator>`.
  5. Sets the bot identity (`:22-25`).
  6. `git fetch origin '+refs/heads/chore/sops-bootstrap:refs/remotes/origin/chore/sops-bootstrap' || true` (narrow-refspec trap, `:36-40`), then `git checkout -B chore/sops-bootstrap`, then commit.
  7. `git push --force-with-lease` with retry (`:62-72`).
  8. Runs `gh pr list --head`. If a PR exists it is edited; otherwise `gh pr create --base main-dev` with `GH_TOKEN=GH_PAT` (`:78-112`). The PR body is both `changes.md` files.

If the guard fails, `pr` is skipped and nothing is pushed.

## Rollout

**Execute step 1 is a gating smoke test** against the pinned binaries. It checks:

- encrypt from stdin with `--filename-override` and `--age`, in two cases: no `.sops.yaml` present, and `cwd=$RUNNER_TEMP` while a repo `.sops.yaml` exists;
- `decrypt --output-type json`;
- `age-keygen -y` reading stdin;
- relative `path_regex` matching;
- how compose treats `$`/`$$` and a trailing space inside single quotes;
- JSON round-trip of a value ending in a space and a newline;
- `secrets[format()]` under `inherit`. This is confirmed at the first deploy-dev at the latest.

Any failure stops the work and goes back to the operator.

1. **Operator setup:**
   - Create 3 age keys (staging, production, operator).
   - Set the environment secret `SOPS_AGE_KEY` in staging and in production.
   - Set the repo variable `SOPS_OPERATOR_AGE_RECIPIENT`.
2. **Preflight** (all must hold):
   - `doctl apps list` shows exactly one `xstockstrat-staging`, with ID == `DO_DEV_APP_ID`. The same holds for production if it is up.
   - Branch policies admit main-dev → staging and main → production.
   - Homelab is disabled, or its env secrets are set.
   - `gh secret list --env staging` and `gh secret list --env production` show no `DEV_*`, `PROD_*` or `DIGITALOCEAN_ACCESS_TOKEN`.
3. **Merge the feature to main-dev; deploy-dev runs against staging.**
   - There is no SOPS file yet, so every key comes from `github` (`DEV_*`), and the app ID resolves by name.
   - **Gate:** the rendered spec is identical once leaf PEMs are normalised (@AC-8).
   - main is unaffected: it still runs the old `deploy.yml`.
4. **Promote to main** (merge commit). deploy-prod waits for a reviewer, then reads `PROD_*` from `github`. **Gate:** every key reports `github`.
5. **Dispatch the bootstrap from main** with `force=false`.
   - Staging seeds. Production waits for a reviewer, then seeds.
   - It opens a PR from `chore/sops-bootstrap` to main-dev.
   - **Gate:** the PR body plus the @AC-1/@AC-7 properties.
6. **Merge the bootstrap PR; deploy-dev reads `sops`.** **Gate:** no `differs from legacy` warning.
7. **Promote.** The prod deploy and prod-up read `sops`.
8. **Follow-up (out of scope):** delete the legacy secrets, `DO_*_APP_ID` and `OP_*`.

If a legacy secret is rotated between steps 5 and 6, the summary reports `sops (differs from legacy)`. Re-run the bootstrap with `force=true`.

## Places to touch per new secret (steady state)

1. One KEYS tuple. This is the only code edit.
2. The consumer surface: `YOUR_{DEV,PROD}_<NAME>` in `.do/app*.yaml` and/or `${NAME}` in `compose.yml`.
3. `sops set` in each env file. This is data, not code.
4. One row in the runbook.

No workflow, caller or renderer edit is needed. A homelab-only app variable needs zero code edits. The `LEGACY_*` lines exist only for the transitional keys.

## Files

- **New:**
  - `scripts/sops_secrets.py`
  - `scripts/do-render-app-spec.py`
  - `scripts/sops-secrets.test.sh`
  - `.github/actions/setup-sops/action.yml`
  - `.github/workflows/sops-bootstrap.yml`
  - `docs/runbooks/sops-secrets.md`
- **Created by the bootstrap PR, not by this feature:** `.sops.yaml`, `secrets/{staging,production}.enc.yaml`.
- **Changed:**
  - Workflows: `deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `prod-up.yml`, `deploy-homelab.yml`.
  - `ci.yml`:
    - Adds a `sops` filter covering the new files, `deploy*.yml`, `prod-up.yml`, `sops-bootstrap.yml` and `.github/actions/setup-sops/**`.
    - Adds a job `sops-secrets` (ubuntu-24.04), gated on `sops || homelab || ci`. It runs setup-sops, `ruff check` + `ruff format --check` on the 2 `.py` files, and `bash scripts/sops-secrets.test.sh`.
    - Adds that job to the ci-gate (`:930-975`).
    - shell-lint (`:654-657`) already globs `scripts/*.sh`, so it picks up the new test script.
  - `.gitignore`: add `*.agekey` and `keys.txt`.
  - `scripts/do-setup-check.sh:111`.
  - Comments in `.do/app.yaml:4` and `.do/app.dev.yaml:4`.
  - `scripts/mtls-provision.sh`: header `:4-12` and the `set-secret` text.
  - The docs sweep: every surface in recon §Risks, including:
    - `docs/setup/digitalocean.md`
    - `docs/runbooks/infra-cost-reduction.md`
    - `docs/patterns/inter-service-mtls.md` (the unified CA)
    - `docs/runbooks/inter-service-mtls-rollout.md`
    - `docs/patterns/ci-overview.md`
    - `docs/runbooks/feature-workflow.md`
    - `docs/runbooks/add-data-source.md`
    - `docs/setup/grafana-cloud.md`
    - `docs/launch-pdfs/infra-ci.md`
    - `.env.example`
    - `scripts/setup-env.sh` comments
    - `.claude/skills/digitalocean-setup/SKILL.md`
    - identity `CLAUDE.md` and `docs/operations.md`
    - notify `CLAUDE.md`
    - `docs/runbooks/CLAUDE.md` index
- **Deleted:** `scripts/do-inject-prod-secrets.py`.

## AC → test mapping

`sops-secrets.test.sh` is hermetic: `env -i`, throwaway age keys, a SECRETPROBE canary, a local bare-repo origin, and the real pinned sops/age and docker compose.

| AC | Verification |
|---|---|
| AC-1 | Auto: decrypting with the other env's key fails, stderr contains `no matching keys`, and no value is printed; decrypting with the env's own key succeeds; exactly 2 recipients. Rollout: the same checks on the real files. |
| AC-2, AC-20 | Auto: the top-level keys are exactly {common, digitalocean}; the homelab probe is absent; no platform credentials or APP_ID are present. |
| AC-5 | Auto: resolve → real `homelab-release-env.sh` → `docker compose config --format json` yields the exact `p$w #1 "x"` / `j$t`; body lines come before common lines. |
| AC-6 | Auto: the exact message; the probe is absent from stdout, stderr and the out dir. |
| AC-7 | Auto: every leaf starts with `ENC[AES256_GCM,`; `.sops.yaml` generation is unit-tested. Rollout: the PR. |
| AC-8 | Auto, permanent: the reverse-substitution identity test (below). Auto: with the file absent, the summary lists `<K>: github` for every KEYS entry. Plus a one-time normalised old-vs-new comparison, recorded in context.md. |
| AC-9 | Auto: precedence, summary labels, masks emitted before any other output. |
| AC-10 | Auto: the exact error; `--out` is never written, so update never runs. |
| AC-11, AC-16 | Auto: the prod-up render written to `$RUNNER_TEMP/app.yaml` contains the VAPID and MTLS values and leaves no placeholder. |
| AC-12 | Static: no match for `\bop\b|1password|OP_` in `deploy-homelab.yml`. Live, at homelab enablement: `gate status` exits 0. |
| AC-13 | Auto: `DEPLOY_KNOWN_HOSTS: github`. |
| AC-14 | Inspection. |
| AC-15 | Auto: the guard's exact message; a fetch failure reports `cannot fetch main-dev`. |
| AC-17, AC-21 | Execute-time: stub `doctl` returning 0, 1 and 2 matches. |
| AC-18 | Auto: the compose `MTLS_CA_CERT` equals the fixture CA. |
| AC-22 | Behaviour: an env-only `MTLS_CA` is ignored. Static: the rules below. |
| AC-23 | Auto: the exact error; neither value is logged. |
| AC-24 | Auto: no `MCP_AGENT_SECRET` in the new surfaces, the deploy workflows or the `.do` specs. |
| No normalisation | Auto: `"trail-v \n"` stays byte-equal through resolve (sops and legacy), render, and build → verify → decrypt. `"tr ail "` survives compose. A trailing newline in a `K='V'` key is refused and the key is named. |

**AC-8 reverse-substitution test.** For each real `.do/app*.yaml`:

1. Render with fixed-width, delimited sentinels `__S286_NN__` and a fixture CA. Each sentinel is asserted absent from the sed-only output.
2. Diff line by line against the sed-only output. Every differing line must be a placeholder line.
3. Map back:
   - sentinels → their placeholders;
   - `Authorization=<sentinel>` → its placeholder;
   - the exact CA PEM → the CA placeholder;
   - leaf PEMs → their placeholders, after these checks:
     - the PEM matches the PEM regex;
     - the SAN is `xstockstrat-<sfx>` for the line's suffix;
     - it verifies against the fixture CA;
     - each `MTLS_KEY_<sfx>`'s public key equals the same-suffix cert's public key (as at `mtls-provision.sh:88-90`).
4. The mapped-back output must be byte-equal to the sed-only output.

Targeted asserts:

- the OTEL prefix, in both cases;
- an absent optional renders as `''`;
- `${xstockstrat.CA_CERT}` is left intact;
- no `YOUR_` placeholder remains;
- no `MCP_AGENT_SECRET`;
- a `name:` mismatch fails.

Any failure names the offending line.

**AC-22 static rules.** For each of the 4 workflows:

- Every `^\s*LEGACY_[A-Z0-9_]+:` line exactly equals its expected text.
- The set of names equals the KEYS-derived set for that target, and each name appears exactly once.

Expected texts:

- **deploy.yml (12):**
  - `LEGACY_<K>: ${{ secrets[format('{0}_<K>', env.P)] }}`
  - `LEGACY_PROJECT_ID: ${{ secrets[format('DO_{0}_PROJECT_ID', env.P)] }}`
- **deploy-homelab.yml (14):**
  - the 9 common keys in the deploy.yml `<K>` form;
  - `LEGACY_<H>: ${{ secrets.<H> }}` for TS_AUTHKEY, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS and APP_ENV;
  - `LEGACY_TS_AUTHKEY_EXPIRES: ${{ vars.TS_AUTHKEY_EXPIRES }}`.
- **sops-bootstrap.yml (12):** the deploy.yml forms, with `matrix.prefix` in place of `env.P`.
- **prod-up.yml (12):** `${{ secrets.PROD_<K> }}` and `${{ secrets.DO_PROD_PROJECT_ID }}`.

Additional rules:

- deploy.yml and deploy-homelab.yml each have exactly one job-level `P:` line, with exactly the C6 text, and no step-level `P:`.
- The bootstrap matrix is exactly the two pinned pairs plus `environment: ${{ matrix.environment }}`.
- No unprefixed `secrets.<common K>` appears in deploy.yml, prod-up.yml or deploy-homelab.yml.
- `DO_APP_ID`, `DO_DEV_APP_ID` and `DO_PROD_APP_ID` are absent from `deploy*.yml` and `prod-up.yml`.
- The DO callers use `secrets: inherit` with no `secrets:` mapping.

The expected sets are derived from KEYS through `python3 -c` with a `sys.path` insert.

## Rejected Alternatives

- **Bash resolver:** JSON handling, per-line masking and SHA compares are fragile in bash 3.2. Stdlib Python is already a deploy dependency (`deploy.yml:130`, `mtls-provision.sh:58`).
- **`resolve -- exec child` mode:** gives the same single-process guarantee as an in-process import, with more to build.
- **`toJSON(secrets)` into one step:** exposes every repo secret, platform credentials included, to one process. Per-key `LEGACY_*` is least-privilege and can be pinned statically.
- **Explicit caller passthrough, or a `LEGACY_DO_*` rename:** keeps the 14-line DRY hazard. Also, in an env-bound job, same-named environment secrets can shadow passed values, which caused the silent CA swap in round-1 O1. `inherit` + `format()` makes shadowing structurally impossible.
- **Same-named homelab fallbacks for common keys:** contradicts FR-10 and the DO-wins rule (round-2 C1).
- **Resolving at the image commit (after detach):** a rollback would run old tooling and old secrets, and old commits lack the script and action (round-1 O2).
- **Per-key fallback when the file can't be decrypted:** silently hides a broken key or file and brings stale values back. Fail closed instead.
- **Golden rendered-spec files:** leaves are re-minted on every deploy, and goldens become tautological after the first spec edit. Reverse substitution against the real spec is permanent.
- **Per-env bootstrap input:** YAGNI. The matrix plus a per-env guard is one dispatch, and a later single-env re-seed is done locally with `sops`.
- **1Password reads in the bootstrap:** YAGNI for a homelab that isn't live (operator, round-1 gate).
- **prod-up updating a stored APP_ID through a SOPS PR:** leaves main stale until merge and promotion. Resolving the app by name removes the hazard (FR-11, operator).
- **Per-name 0600 files instead of `GITHUB_ENV` for homelab:** more plumbing for infra credentials. Waived by the operator: only first-party scripts follow, with no `uses:` after resolve.
- **Inline pins in each workflow:** 5 copies of version + SHA. A single composite action is the one home for them.
- **Hand-editing `platform.feature:15`:** forbidden (`docs/sdd/business-rules/CLAUDE.md:51`). @AC-24 is promoted at launch instead.

## Open Risks

| # | Risk | Target |
|---|---|---|
| 1 | The reverse map assumes each placeholder is on its own line and each substitution is a single line. It fails closed and names the line. | Execute (render + AC-8 test step) |
| 2 | Parity with the old inline python can only be proven once, because the old code is deleted. The proof is the normalised comparison recorded in context.md. | Execute (render step) |
| 3 | Whether a trailing newline survives the `GITHUB_ENV` heredoc depends on the runner's parser and can't be tested hermetically. The consumers are tolerant (`printf '%s\n'`). | Rollout, at homelab enablement |
| 4 | A common value containing a newline deploys on DO but is refused for homelab `K='V'`. The refusal is loud and names the key. | Runbook note |
| 5 | gitleaks may flag the age armor or the recipients. | Execute (bootstrap step): allowlist |
| 6 | If the SOPS file exists without `homelab.app_env`, homelab uses the legacy blob, minus common keys, plus the DO tail. | Runbook: `sops set` app_env before enabling homelab |
| 7 | `secrets[format()]` under `inherit` in a reusable job's step env is unverified. If it fails, the deploy fails closed with MISSING. | Execute step 1 / first deploy-dev |
| 8 | The production reviewer gate now pauses every main push deploy and every prod-up run. | Accepted by the operator; documented in the runbook |

## Constitution Rules Touched

- **C-01 / F-04:** every path and line cited was verified in the working tree. Anything unverified is listed under Assumptions.
- **C-08 / C-15:** every active AC maps to a test. AC-14 is inspection only.
- **C-10:** the two hand-synced substitution copies become one. Every surface from the fails.md L1095 trap is listed in Files.
- **C-11:** the full SDD pipeline ran (story → review → design, full mode).
- **C-13:** waiver. The inline fixture-CA builder is a second consumer of `homelab-render.test.sh:27-28`, and `scripts/` shell tests have no canonical fixture home (`docs/patterns/test-data-inventory.md:70-83`). Extract it to a sourced helper when a third consumer appears.
- **C-14:** the consumer surface is None (pipeline/operator).
- **C-16:** see below. No CHANGE.
- **C-18:**
  - one KEYS table;
  - the composite action is justified by 5 consumers;
  - per-key `LEGACY_*` verbosity, pinned statically, is chosen over `toJSON(secrets)`.
- **P-03:** the proposer's flags were surfaced and resolved by the orchestrator (AC-24; tighter A1 rules).
- **F-02:** the bootstrap pushes only `chore/sops-bootstrap` and opens a PR.
- **F-07:** not applicable. These are deploy-time secrets, not WatchConfig keys.

## Business Rules Touched (C-16)

**PRESERVE:**

| Rule (suite, feature) | How it is preserved |
|---|---|
| platform @AC-8 @feature-147 | No MCP_AGENT_SECRET (@AC-24). |
| platform @AC-1, @AC-2, @AC-4, @AC-6 @feature-210 | Fail-closed mTLS on both targets, with one CA per environment. Homelab isn't live, so no stream rotation is at risk. |
| platform @AC-1, @AC-5 @feature-266 | `${xstockstrat.CA_CERT}` survives (asserted). |
| config @AC-1, @AC-16 @feature-147 | CONFIG_SECRETS_ENCRYPTION_KEY is byte-identical (no-normalisation test; A1 pins). |
| config @AC-4; fix-marketdata-secret-exposure @AC-3, @AC-4, @AC-6 | SAN `xstockstrat-<svc>` is unchanged (reverse-map SAN check). |
| agent @AC-9; identity @AC-4 | JWT_SECRET is identical and unchanged (A1 pins). |
| identity @AC-9, @AC-10 @feature-242 | SAN-bound grant. |
| notify @AC-1, @AC-2, @AC-3 @feature-020 | Slack and SendGrid stay optional, with names kept. |
| notify @AC-4, @AC-5, @AC-6 @feature-165 | VAPID stays optional and unchanged. |
| trading @AC-4 @feature-249 | BROKER key is unchanged (A1 pins). |
| platform @AC-1 @feature-226; @AC-19 @feature-274 | The OTEL `Authorization=` prefix logic is unchanged. |

**EXTEND:**

- platform @AC-8 @feature-147, through this feature's @AC-24, promoted at launch. Its Then names the deleted `do-inject-prod-secrets.py`.
- platform @AC-1/@AC-2 @feature-218: the local `.env` path is untouched.

## Assumptions

- **[verify-at-spec]**
  - Exact sops (≥3.9) and age versions, with their SHA-256s, and the action-doctl and upload-artifact SHA pins.
  - A grep confirms every `YOUR_(DEV|PROD)_*` placeholder is covered by KEYS or MTLS and sits alone on its line.
  - The ci.yml `sops` filter path list.
- **[verify-at-execute-step-1]**
  - The sops flags, and avoiding `.sops.yaml` via `cwd`.
  - `age-keygen -y` reading stdin.
  - Relative `path_regex` matching.
  - compose `$`/`$$` and trailing-space handling in single quotes.
  - `secrets[format()]` under `inherit`.
- **[preflight]** Everything in rollout step 2.
- The app-ID lookup stays inline in deploy.yml, so AC-17/AC-21 are execute-time stub tests rather than CI tests.

## Rounds

The design ran for 4 rounds and ended with operator approval at the round-4 gate (2026-11-03).

| Round | Outcome |
|---|---|
| R1 | NEEDS WORK. Blocker: the CA shadow. |
| R2 | APPROVABLE WITH CONDITIONS. |
| R3 | APPROVABLE WITH CONDITIONS. Major: AC-22 RHS pinning. |
| R4 | The consolidated design, with every amendment folded in. |
