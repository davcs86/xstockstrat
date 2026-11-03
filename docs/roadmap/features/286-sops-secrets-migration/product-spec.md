# Product Spec: sops-secrets-migration

**Created**: 2026-11-03

---

## Problem Statement

Deploy-time secrets are split across three stores: repo-level GitHub secrets with `DEV_*`/`PROD_*`
prefixes (DO App Platform), GitHub Environment secrets, and a 1Password vault (homelab). GitHub
secrets are write-only and unversioned. Nobody can review what changed, diff a rotation, or confirm
that staging and production carry the intended values. The 1Password path also adds a second
credential (`OP_SERVICE_ACCOUNT_TOKEN`) with its own expiry and a pinned CLI download. The operator
wants one versioned, reviewable, per-environment store.

## User Story

As the platform operator, I want deploy-time secrets moved into SOPS-encrypted (age) files committed
to the repo, with each environment's decryption key stored as a GitHub Environment secret, and a
one-shot bootstrap GitHub Action that builds the first SOPS files from the currently effective values,
so that secrets are versioned, reviewable and rotatable without service disruption.

## Functional Requirements

FR-1. **Layout.** One SOPS file per environment, `secrets/staging.enc.yaml` and
`secrets/production.enc.yaml`, encrypted with age, with three top-level namespaces:
`common:` holds what the app needs to run regardless of hosting, `digitalocean:` holds values used only
by the DO App Platform deploy, and `homelab:` holds values used only by the homelab deploy. A key
lives in exactly one namespace, and consumers read `common` + their own target namespace.
`.sops.yaml` maps each file to exactly two recipients: that environment's age public key and the
operator recipient.

FR-2. **Key custody.** Each environment's age private key is stored only in the GitHub Environment
secret `SOPS_AGE_KEY` of the existing `staging`/`production` environments. The operator's personal
age public key is the repo variable `SOPS_OPERATOR_AGE_RECIPIENT`. The staging key must not be able
to decrypt the production file, and the production key must not be able to decrypt the staging file.

FR-3. **Scope and requiredness.** (R = required: fail-closed when it is in neither store. O = optional:
omitted when absent.)
- `common`: JWT_SECRET (R), BROKER_ACCOUNTS_ENCRYPTION_KEY (R), CONFIG_SECRETS_ENCRYPTION_KEY (R),
  MTLS_CA (R; a single platform CA shared by both targets, see FR-10), SLACK_WEBHOOK_URL (O),
  SENDGRID_API_KEY (O), VAPID_PRIVATE_KEY (O), VAPID_PUBLIC_KEY (O), VAPID_SUBJECT (O),
  OTEL_EXPORTER_OTLP_ENDPOINT (O), OTEL_EXPORTER_OTLP_HEADERS (O). Today these come from the
  `DEV_*` (staging) / `PROD_*` (production) repo secrets.
- `digitalocean`: APP_ID (R for DO deploys), PROJECT_ID (O). Today these come from
  `DO_DEV_APP_ID`/`DO_PROD_APP_ID` and `DO_DEV_PROJECT_ID`/`DO_PROD_PROJECT_ID`.
- Platform credentials stay native GitHub secrets: DIGITALOCEAN_ACCESS_TOKEN (the account credential,
  shared across environments and used by the environment-less `prod-down.yml`), GH_PAT, GH_PAT_SCAN,
  BUF_TOKEN and GITHUB_TOKEN.

FR-4. **Scope, homelab.** `homelab`: TS_AUTHKEY, TS_AUTHKEY_EXPIRES, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS,
and `app_env`. `app_env` is APP_ENV exploded into a `{KEY: VALUE}` map with raw string values, and
any key that belongs to `common` is excluded from it. Homelab is not live yet, so every homelab key is
**O at bootstrap** (omitted when absent) and **R at homelab deploy time** (FR-7).

FR-5. **Bootstrap workflow.** A `workflow_dispatch` workflow runs once per environment (matrix
`staging`/`production`, each job bound to its GitHub Environment). It:
(a) resolves every in-scope value from its **currently effective** source. For homelab that is
1Password when `OP_SERVICE_ACCOUNT_TOKEN` is usable (same expiry rule as today), else the GitHub
secret. For DO it is the `DEV_*`/`PROD_*` repo secret;
(a2) builds `common` from the DO sources. **DigitalOcean wins:** when a homelab source (APP_ENV or the
homelab MTLS_CA) holds a different value for a `common` key, the DO value is kept and the homelab value
is dropped. The job logs a warning that lists only the conflicting key *names*;
(b) derives the env recipient from `SOPS_AGE_KEY` via `age-keygen -y` and writes `.sops.yaml`;
(c) encrypts the file;
(d) self-verifies by decrypting with `SOPS_AGE_KEY` and comparing the key set and per-value SHA-256
against the sources, plus an APP_ENV parse→render round-trip;
(e) pushes branch `chore/sops-bootstrap` and opens a PR to `main-dev` with `GH_PAT`;
(f) refuses to run for an environment whose `secrets/<env>.enc.yaml` already exists on `main-dev`
unless the `force` input is `true`.
It never prints, uploads or caches a plaintext value. An absent optional value is omitted from the
file, never written as an empty string. A missing required value fails the job.

FR-6. **DO deploy consumption.** `deploy.yml` (called by `deploy-dev.yml`/`deploy-prod.yml`) and
`prod-up.yml` bind their jobs to the `staging`/`production` environment. They decrypt
`secrets/<env>.enc.yaml`, read `common` + `digitalocean`, and resolve each key **SOPS first, with a per-key fallback to the legacy
GitHub secret**. Every key's source (`sops`/`github`/`MISSING`) goes to the step summary. The job
fails closed only when a required key is in neither store. Every decrypted value is masked
(`::add-mask::`) before any further step runs.

FR-7. **Homelab consumption.** `deploy-homelab.yml` drops 1Password entirely: no op CLI install, no
`load-secrets-action`, no `OP_SERVICE_ACCOUNT_TOKEN`/`OP_VAULT`/`OP_TOKEN_EXPIRES` reads. It
resolves each key SOPS first (`common` + `homelab`), with a per-key fallback to the same-named legacy
GitHub environment secret (`vars.TS_AUTHKEY_EXPIRES` for the expiry). It renders `common`'s app keys
plus `homelab.app_env` into the dotenv blob that `scripts/homelab-release-env.sh` consumes as
`APP_ENV`, and it passes `common.MTLS_CA` as `MTLS_CA`. The script's contract does not change. The
source report and the fail-closed rule match FR-6, and every homelab key is required here.

FR-8. **Operator runbook.** Document key generation, environment setup, running the bootstrap,
local edit/rotation (`sops secrets/<env>.enc.yaml` with the operator key), adding a key, and the
follow-up removal of legacy secrets once every key reports `sops`.

FR-9. **Prod bring-up parity.** `prod-up.yml` (via `scripts/do-inject-prod-secrets.py`) injects the
same full key set as `deploy.yml` — adding VAPID_PRIVATE_KEY/PUBLIC_KEY/SUBJECT and minting the mTLS
leaves from `common.MTLS_CA` — so a recreated prod app is not missing keys a regular deploy sets. Because a recreated app gets a
new ID, prod-up's closing instruction changes to "update `digitalocean.APP_ID` in
`secrets/production.enc.yaml`" (SOPS takes precedence over the legacy `DO_PROD_APP_ID`).

FR-10. **Unified mTLS CA.** DO and homelab share one platform CA per environment (`common.MTLS_CA`,
seeded from DO's `DEV_MTLS_CA`/`PROD_MTLS_CA`). This reverses the "separate CA from DO's" rule in
`docs/patterns/inter-service-mtls.md`, and that doc is updated. There is no disruption because homelab
is not live, and DO's CA does not change.

## Out of Scope

- Deleting the legacy GitHub secrets, 1Password items or `OP_SERVICE_ACCOUNT_TOKEN`. That is a
  follow-up, gated on the source report showing `sops` for every key in both environments.
- Platform/workflow-identity credentials (FR-3 exclusion list).
- Runtime secrets inside `xstockstrat-config` (the feature 147 encrypted config rows), and vendor credentials.
- Changing how secrets reach DO App Platform at runtime (`type: SECRET` app-spec env vars stay as they are).
- Any cloud KMS, or PGP.

## Affected Services

No runtime service changes. Only CI/deploy plumbing changes:
- `.github/workflows/` — `deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `prod-up.yml`,
  `deploy-homelab.yml`, plus a new `sops-bootstrap.yml`
- `scripts/` — `do-inject-prod-secrets.py` (prod-up consumer) and a new shared SOPS resolve helper
- `.github/workflows/prod-down.yml` — read only to confirm it needs no change (it uses only DIGITALOCEAN_ACCESS_TOKEN)
- `docs/` — `docs/setup/digitalocean.md` (secrets table), `docs/runbooks/infra-cost-reduction.md`
  (prod bring-up secret list), `docs/patterns/inter-service-mtls.md` (CA location), a new
  `docs/runbooks/sops-secrets.md`, and `services/xstockstrat-identity/CLAUDE.md` +
  `services/xstockstrat-identity/docs/operations.md` (they name `DEV_/PROD_JWT_SECRET`)

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None**: internal/platform-only. The consumer is the deploy pipeline and the operator, and
  running services receive the same env vars with the same values.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/sops-secrets-migration` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — N/A
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A
- [x] Security + Platform Lead review (secret custody, deploy topology)

Rollout order (no-disruption contract): (1) the operator creates keys and env secrets; (2) the
dual-read consumers merge first. With no SOPS file present, every key falls back to `github`, so
nothing changes. (3) The bootstrap runs and its PR merges, and keys flip to `sops`. (4) Legacy
secrets are removed in a follow-up.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`), the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Notes for Design / Spec

Known traps from the Ledger (Constitution **P-05**). These are obligations on `/sdd-design` and `/sdd-spec`, not open questions:
- **`fails.md` L1095 (FINNHUB_API_KEY):** secret wiring spans the reusable `deploy.yml` `secrets:`
  block, the `deploy-dev.yml`/`deploy-prod.yml` passthrough, `scripts/do-inject-prod-secrets.py`,
  `prod-up.yml`, `docs/setup/digitalocean.md` and `docs/runbooks/infra-cost-reduction.md`. The impl
  spec must cite every one of these surfaces as Codebase Evidence.
- **`fails.md` L443:** a spec'd secret name must never be swapped during execute without re-running `/sdd-spec`.
- `deploy-dev.yml:73` / `deploy-prod.yml:72` already set `environment:` on the homelab caller job. The
  impl spec must name exactly which jobs gain the binding: the reusable `deploy.yml` `deploy` job and `prod-up.yml` `up`.
- Stale-ID hazard: once `digitalocean.APP_ID` exists, updating only the legacy `DO_PROD_APP_ID`
  after prod-up has no effect. The fallback is per key and SOPS wins. Deploy fails safely (doctl errors
  on an unknown ID), but the runbook and prod-up's warning must point at the SOPS file.
- Keep 279's `HOMELAB_DEPLOY_ENABLED` gate in `deploy-dev.yml`/`deploy-prod.yml` intact, and keep the
  `scripts/homelab-release-env.sh` contract unchanged.

## Open Questions

- [x] `production` environment protection rules: the operator confirmed there are none that block
  binding the DO deploy jobs to it (2026-11-03).
- [x] `prod-up.yml` key set: **align to the full set** (operator, 2026-11-03). See FR-9.
- [x] Bootstrap re-run: refuse unless `force: true` (operator, 2026-11-03). See FR-5(f).
- [x] `sops` binary: not preinstalled on `ubuntu-latest`. Resolved: install a pinned `sops` release
  and `age` with SHA-256 verification, following the `OP_CLI_*`/`TAILSCALE_*` env-pin pattern in
  `deploy-homelab.yml`. The exact version is chosen at spec time.
