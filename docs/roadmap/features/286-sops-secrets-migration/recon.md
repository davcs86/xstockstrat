# Recon: sops-secrets-migration

**Created**: 2026-11-03
**From**: product-spec.md (FR-1..FR-11)
**Affected surfaces**: DO App Platform deploy chain, homelab deploy chain, CI/scripts harness, docs. No
runtime service code.

---

## Objective

Move deploy-time secrets into per-environment age-encrypted SOPS files (`secrets/{staging,production}.enc.yaml`,
namespaces `common`/`digitalocean`/`homelab`), with the decryption key in each GitHub Environment's
`SOPS_AGE_KEY`. The deploy workflows read SOPS first and fall back key by key to the legacy GitHub secrets.
A one-shot bootstrap workflow seeds the files from the values in effect today and opens a PR. Homelab drops
1Password, and DO resolves the app ID by spec name. No runtime value changes: every secret must reach the
containers byte-identical, under the same env var names.

## Codebase Map

- **DO reusable deploy**: `.github/workflows/deploy.yml`
  - `on.workflow_call.secrets` :14-75. Required: DIGITALOCEAN_ACCESS_TOKEN :15, DO_APP_ID :17,
    BROKER_ACCOUNTS_ENCRYPTION_KEY :23, JWT_SECRET :27, CONFIG_SECRETS_ENCRYPTION_KEY :31. Optional:
    DO_PROJECT_ID :19, SLACK/SENDGRID/VAPID×3/OTEL×2 :37-62, MTLS_CA :67 (fail-closed at substitution).
  - `jobs.deploy` :78, `runs-on: ubuntu-latest` :79, **no `environment:`, no `permissions:`**.
  - Mint mTLS :87-103 (`mtls-provision.sh decode-ca` :100 → `gen-dev-certs.sh` :101 → `MTLS_CERTS_DIR` :102).
  - Substitute :105-198: env :107-116, `sed` :118-121, inline `python3 -c` :130-198 (DEV+PROD twins
    :134-164, OTEL `Authorization=` prefix :161-162, MTLS block :165-196, leftover check :193-196).
  - `DO_APP_ID` used at :203 (`doctl apps update`), :213 (project assign), :220 (wait). `DO_PROJECT_ID` :208-212.
- **DO callers**: `deploy-dev.yml` job `deploy` :43-64. Passthrough :47-61 (`DO_APP_ID: secrets.DO_DEV_APP_ID` :49,
  `MTLS_CA: secrets.DEV_MTLS_CA` :61), `app_spec: .do/app.dev.yaml` :63. `deploy-prod.yml` has the same shape at
  :42-62 (PROD_*, `.do/app.yaml`). Homelab caller jobs: `deploy-dev.yml:66-74` (`if: vars.HOMELAB_STAGING_ENABLED`
  :69, `secrets: inherit` :71) and `deploy-prod.yml:65-73` (`vars.HOMELAB_PRODUCTION_ENABLED` :68).
- **Prod lifecycle**: `prod-up.yml` has no `environment:`. Its by-name resolver is at :35-36
  (`doctl apps list --format ID,Spec.Name --no-header | awk '$2=="xstockstrat-production"{print $1}'`). The render
  env at :45-54 has **no VAPID or MTLS**. It invokes `scripts/do-inject-prod-secrets.py` at :60, and the stale-ID
  warning is at :106 (header :10). `prod-down.yml` reads only DIGITALOCEAN_ACCESS_TOKEN :26 and uses the same
  by-name awk at :30-31.
- **`scripts/do-inject-prod-secrets.py`**: PROD-only. Required tuples :33-37, optional :42-53, OTEL prefix :73-74.
  It has no MTLS support and **no tests**. Its docstring :13-15 says it "mirror[s] deploy.yml".
- **App specs**: `.do/app.yaml:5` `name: xstockstrat-production`, `.do/app.dev.yaml:5` `name: xstockstrat-staging`.
  The header line :4 in both mentions DO_*_APP_ID. Placeholders: `YOUR_{DEV,PROD}_{JWT_SECRET,BROKER_…,CONFIG_…,
  SLACK_WEBHOOK_URL,SENDGRID_API_KEY,VAPID_*,OTEL_*,MTLS_CA_CERT,MTLS_CERT_<SFX>,MTLS_KEY_<SFX>}` (12 SFX).
- **Homelab deploy**: `.github/workflows/deploy-homelab.yml`
  - Header contract :1-2. Job `environment: ${{ inputs.environment }}` :45, concurrency :46-48, permissions :49-51.
  - Pins: TAILSCALE_* :35-36, OP_CLI_* :38-39.
  - 1Password: `src` :103-123, `opcli` :125-135, `op` load :137-151 (6 refs), report :153-175.
  - Fallbacks: `TS_AUTHKEY_EXPIRES || vars.TS_AUTHKEY_EXPIRES` :179, APP_ENV :189, MTLS_CA :190, TS_AUTHKEY :208,
    DEPLOY_SSH_KEY :219, DEPLOY_KNOWN_HOSTS :220.
  - Expiry gate :177-185, release env :187-193, render check :195-196, ship :231-242.
- **Homelab scripts**:
  - `homelab-release-env.sh` takes `APP_ENV` (an opaque dotenv blob, required) and `MTLS_CA` (required) at :13,
    plus `TARGET_ENV` :16-23. The `owned` regex :34 strips pipeline keys, and :36 passes the rest through verbatim.
  - `homelab-render-check.sh` runs compose `:?` requireds plus `render-assert.jq`.
  - `homelab-render.test.sh` is the harness. `base_env` :37-43 is the de facto required APP_ENV set: DB_PASSWORD,
    JWT_SECRET, BROKER_…, CONFIG_…, SEED_USER_ID, APP_URL.
- **Compose expectations** (`deploy/homelab/compose.yml`):
  - Required: DB_PASSWORD :12, SEED_USER_ID :37, CONFIG_SECRETS_ENCRYPTION_KEY :49, JWT_SECRET :87/:276/:310,
    BROKER_ACCOUNTS_ENCRYPTION_KEY :215, APP_URL :273.
  - Optional: SLACK :109, SENDGRID :110, VAPID :111-113/:275.
  - OTEL is hardcoded off (:7), so there is no OTEL interpolation.
- **mTLS CA format**: `scripts/mtls-provision.sh` `emit_ca` :56-70 / `decode-ca` :72-94 use base64(JSON
  {ca_cert, ca_key}) with a pubkey match check. DO and homelab use the **same format**. `set-secret` :117-127
  writes `DEV_/PROD_MTLS_CA` via `gh secret set`.
- **CI harness** (`.github/workflows/ci.yml`):
  - paths-filter :14-119. `ci` key = ci.yml only :41. `scripts` = `scripts/**` :67-69. `homelab` :80-85
    includes `deploy-homelab.yml`.
  - `shell-lint` :640-660 runs shellcheck+shfmt on `scripts/*.sh` and an **explicit** test list at :660.
    `homelab-render` :897-908 runs in the `ci-gate` needs list (:930-953, echo :958+).
  - No actionlint. No pytest over `scripts/`.

## Patterns to REUSE

- Pinned binary install (sops, age) → `deploy-homelab.yml:198-204` (Tailscale: workflow env VERSION+SHA256,
  `curl -fsSLO`, `sha256sum -c -`, `sudo install -m 0755`), same shape at `:125-135`.
- Per-key source report → `deploy-homelab.yml:153-175` ("### Secret sources", `- $n: $src`, `::error::` on MISSING).
- Branch + PR with GH_PAT → `sync-main-to-maindev.yml`:
  - checkout with token fallback :20, bot identity :22-25, GH_PAT presence warning :27-31
  - push retry/backoff :62-72, existing-PR idempotency `gh pr list --head` :83
  - `GH_TOKEN` rationale :78-80, `gh pr create --base main-dev` :100-112
  - permissions `contents: write`, `pull-requests: write` :11-13
- By-name DO app resolution → `prod-up.yml:35-36` / `prod-down.yml:30-31` awk on `Spec.Name`.
- mTLS mint from a CA bundle → `deploy.yml:87-103` + `mtls-provision.sh decode-ca`. Homelab already reuses
  it in `homelab-release-env.sh:32-33`.
- Release .env construction → `homelab-release-env.sh` (unchanged contract: feed it a rendered APP_ENV).
- Shell test style → `homelab-render.test.sh`: `set -uo pipefail`, `fail()`, mktemp+trap, `env -i`
  hermetic invocation, the `SECRETPROBE` leak canary :25, numbered cases.
- Substitution table → **consolidate** `deploy.yml:130-198` and `do-inject-prod-secrets.py:33-77`. Today they
  are two hand-synced copies (DRY hazard), and FR-9 requires they become identical.

## Existing Business Rules (preserve / extend)

All verdicts are PRESERVE or EXTEND. There are **no CHANGE flags**, and no existing suite covers deploy,
homelab, prod-up or app-ID resolution, so this feature defines that behaviour for the first time.
- **PRESERVE** `@AC-8` "MCP_AGENT_SECRET is absent from the codebase and deploy surfaces" (`docs/sdd/business-rules/platform.feature`, @feature-147). The new files and workflows must not reintroduce it.
- **PRESERVE** `@AC-4` "mTLS is enforced identically in every environment; verification cannot be disabled" (`platform.feature`, @feature-210). Both targets must inject MTLS_CERT/KEY/CA_CERT and stay fail-closed.
- **PRESERVE** `@AC-1` / `@AC-2` (@feature-210): plaintext is refused, and a valid platform-issued peer is accepted. Every leaf must chain to the one unified CA.
- **PRESERVE** `@AC-6` "A long-lived streaming RPC survives a certificate rotation" (@feature-210). Note: the homelab CA swap is a rotation, but homelab is **not live** (operator, context.md), so there are no streams to drop.
- **PRESERVE** `@AC-5` / `@AC-1` (@feature-266): `DATABASE_CA_CERT=${xstockstrat.CA_CERT}` bindings in `.do/app*.yaml` must survive any spec-rendering change.
- **PRESERVE** `@AC-1`, `@AC-16` (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`, @feature-147): CONFIG_SECRETS_ENCRYPTION_KEY must be delivered **byte-identical**, or every stored secret turns INTERNAL.
- **PRESERVE** `@AC-4` (config, @feature-147/254) and `@AC-3/4/6` (`fix-marketdata-secret-exposure.feature`, @feature-254): SAN-bound grants. Leaf SANs `xstockstrat-<svc>` must stay unchanged.
- **PRESERVE** `@AC-9` (`services/xstockstrat-agent/acceptance/config-secrets-and-scoping.feature`) and `@AC-4` (`services/xstockstrat-identity/acceptance/fix-identity-auth-code-race.feature`): JWT_SECRET must be identical across agent and identity, and unchanged.
- **PRESERVE** `@AC-9/@AC-10` (`services/xstockstrat-identity/acceptance/fix-push-untargeted-broadcast.feature`, @feature-242): SAN `xstockstrat-notify` only.
- **PRESERVE** `@AC-1/2/3` (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`, @feature-020): Slack and SendGrid keep their names and stay optional.
- **PRESERVE** `@AC-4/5/6` (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`, @feature-165): VAPID stays optional, and the values must be unchanged (stored subscriptions embed the public key).
- **PRESERVE** `@AC-4` (`services/xstockstrat-trading/acceptance/fix-ibkr-request-signing.feature`, @feature-249): BROKER_ACCOUNTS_ENCRYPTION_KEY must be unchanged, or every IBKR credential turns INVALID.
- **PRESERVE** `@AC-1` @feature-226 / `@AC-19` @feature-274 (platform): the OTEL_EXPORTER_OTLP_HEADERS raw and percent-encoded forms must be kept, which means the existing `Authorization=` prefix logic is unchanged.
- **EXTEND** `@AC-1/@AC-2` @feature-218 (platform): `setup-env.sh --defaults` local `.env`. SOPS is deploy-only, and local dev is untouched.

## Dependencies

- Proto/RPC: none. Migration: none. Config keys (`xstockstrat-config`): none.
- Inter-service edges: none changed.
- New CI-only secrets/vars: Environment secret `SOPS_AGE_KEY` (staging, production), repo var
  `SOPS_OPERATOR_AGE_RECIPIENT`. Neither is a container env var, so none of them touch docker-compose.yml or `.do/app*.yaml`.
- New files: `.sops.yaml`, `secrets/staging.enc.yaml`, `secrets/production.enc.yaml`, `.github/workflows/sops-bootstrap.yml`,
  a resolver script under `scripts/`, its `.test.sh`, and `docs/runbooks/sops-secrets.md`.
- Tool pins: sops + age release binaries (version/SHA chosen at spec time; `age` is present on this sandbox, `sops` is not).

## Risks / Not-found

- **Spec drift fixed**: product-spec "Notes for Design" named `HOMELAB_DEPLOY_ENABLED`. The real gates are
  `vars.HOMELAB_STAGING_ENABLED` (`deploy-dev.yml:69`) and `vars.HOMELAB_PRODUCTION_ENABLED` (`deploy-prod.yml:68`).
- **Secret-name surfaces beyond the spec list** (fails.md L1095 trap, now enumerated):
  - `scripts/do-setup-check.sh:111` (REQUIRED_SECRETS includes DO_*_APP_ID)
  - `scripts/mtls-provision.sh set-secret` :117-127 (writes DEV_/PROD_MTLS_CA)
  - `.claude/skills/digitalocean-setup/SKILL.md:233,596-597,610-611,663`
  - `.env.example:99-100`, `scripts/setup-env.sh:293-294` (comments)
  - `docs/runbooks/inter-service-mtls-rollout.md:38-43`, `docs/patterns/inter-service-mtls.md:97,104-106`
  - `docs/patterns/ci-overview.md:51,53-65`, `docs/runbooks/feature-workflow.md:204,239`
  - `docs/runbooks/infra-cost-reduction.md:53-71` (already stale: lists removed ALPACA/MCP_AGENT_SECRET)
  - `docs/setup/digitalocean.md:477-509` (stale ALPACA/FMP/FINNHUB rows; missing CONFIG/VAPID/OTEL/MTLS rows)
  - `docs/launch-pdfs/infra-ci.md:188,199,324`
  - `.do/app*.yaml:4`
  - `services/xstockstrat-identity/CLAUDE.md:99`, `services/xstockstrat-identity/docs/operations.md:32-33`
  - `services/xstockstrat-notify/CLAUDE.md:130`, `docs/setup/grafana-cloud.md:169,177`, `docs/runbooks/add-data-source.md:91`
- **DO deploy job has no `environment:`**. Adding it to `deploy.yml`'s job is a reusable-workflow change. The
  environment name must be an input (`staging`/`production`), and environment-scoped secrets become readable
  there. Operator confirmed `production` has no blocking protection rules.
- **`secrets: inherit` vs explicit passthrough**: the DO callers pass explicit secrets, while homelab uses `inherit`.
  The DO reusable workflow cannot read `SOPS_AGE_KEY` unless it is passed or inherited, so this needs a design choice.
- **Masking**: no existing `::add-mask::` use. Values decrypted inside a step are not auto-masked, unlike `secrets.*`.
  Multi-line values (PEM, SSH key, CA bundle) need per-line masking. This is a leak risk if it is mishandled.
- **APP_ENV is passed through verbatim** with no key whitelist (`homelab-release-env.sh:36`). Exploding it to a map means
  rendering it back to `KEY=value` lines. The render-check message requires a single line per key (`homelab-render-check.sh:17`).
- **`.gitignore:59` `secrets.*`**: this pattern does not match `secrets/<env>.enc.yaml`, but would match a root `secrets.enc.yaml`.
  Keep the directory layout. There is no ignore entry for age key files, so add `*.agekey` / `keys.txt`.
- **Bootstrap PR from a workflow**: no existing workflow does `checkout -b` + commit + PR from scratch. The closest is a
  sync-branch force push. The GH_PAT-absent path only *warns* elsewhere. A bootstrap without GH_PAT gets a PR that runs
  no CI, so it should fail instead.
- **paths-filter coverage**: no filter key covers `deploy.yml`, `deploy-dev/prod.yml`, `prod-up.yml`, or a new
  `sops-bootstrap.yml`. Resolver tests must be wired via `scripts/**` (shell-lint list :660) or a new filter key.
- **No tests** exist for `do-inject-prod-secrets.py` or the deploy.yml substitution. FR-9 parity is untestable today.
- **External repo**: the homelab operator runbook lives in homelab-edge (`ci-overview.md:65`), so it is out of reach for edits here.
- Not found: actionlint, CODEOWNERS, any prior sops/age/`.sops.yaml`/`::add-mask::` use.

## Recommended Scope

1. Resolver script (`scripts/sops-env.*`): decrypt → select namespaces → per-key SOPS→legacy fallback → mask →
   export to `$GITHUB_ENV`/step outputs → source report. Plus a hermetic `.test.sh` with a throwaway age key.
2. Unified DO substitution: extract the deploy.yml inline python into a tested script, used by deploy.yml and prod-up
   (replaces `do-inject-prod-secrets.py`), with full keys including VAPID/MTLS.
3. DO workflows: environment binding, SOPS resolver, app ID by name, removal of the DO_APP_ID input/passthrough.
4. Homelab workflow: drop 1Password, use the resolver (`common`+`homelab`), and render the APP_ENV map.
5. Bootstrap workflow + `.sops.yaml` generation + self-verify + force guard + PR.
6. CI wiring (filter keys, test list, ci-gate) + `.gitignore`.
7. Docs sweep (the enumerated surfaces above) + `docs/runbooks/sops-secrets.md` + `mtls-provision.sh set-secret` retarget.
