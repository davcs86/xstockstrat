# SOPS deploy secrets

Deploy-time secrets live in `secrets/staging.enc.yaml` and `secrets/production.enc.yaml`: SOPS files encrypted with age.
Each environment's age private key is the GitHub Environment secret `SOPS_AGE_KEY`. Every file also lists the
operator's personal key (repo variable `SOPS_OPERATOR_AGE_RECIPIENT`) as a recipient, for local edits and recovery (feature 286).

| Namespace | Keys | Read by |
|---|---|---|
| `common` | `JWT_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`, `CONFIG_SECRETS_ENCRYPTION_KEY`, `MTLS_CA` (required); `SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (optional) | DigitalOcean and homelab (OTEL: DO only) |
| `digitalocean` | `PROJECT_ID` (optional) | `deploy.yml`, `prod-up.yml` |
| `homelab` | `TS_AUTHKEY`, `TS_AUTHKEY_EXPIRES`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID`, `DB_CA_CERT` (all required) | `deploy-homelab.yml` |

The tooling lives in `scripts/sops_secrets.py`, which holds the one `KEYS` table, and `scripts/do-render-app-spec.py`.
Every deploy resolves each key **SOPS first**, then falls back to the legacy GitHub secret:

- DO and homelab common keys fall back to the `DEV_*` / `PROD_*` repo secrets.
- Homelab-only keys (including `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` and `DB_CA_CERT`) fall back to the same-named environment secrets.

A target's own namespace (`homelab` for homelab, `digitalocean` for DigitalOcean) overrides a same-named `common` key, but only when `KEYS`
declares the name under both namespaces. An overriding key falls back to its own plain environment secret, and a required `common` key stays
required. A `homelab.<common name>` value that `KEYS` does not declare is **not** an override: it is silently ignored, as are other
unknown or misspelled keys under `homelab`.

The homelab `APP_ENV` is the flat homelab keys followed by the `common` keys; `TS_AUTHKEY`, `TS_AUTHKEY_EXPIRES`, `DEPLOY_SSH_KEY`,
`DEPLOY_KNOWN_HOSTS`, `MTLS_CA` and `DB_CA_CERT` are exported on their own and are not part of the `APP_ENV` blob.
`DB_CA_CERT` is the PEM of the homelab Postgres CA (homelab-edge `db_tls_ca_crt`, one CA for both environments);
`homelab-release-env.sh` writes it to the `.env` as `DATABASE_CA_CERT` for the direct-route Node services.
When homelab-edge rotates `db_tls_ca_crt`, `sops set` the new PEM in both `secrets/staging.enc.yaml` and `secrets/production.enc.yaml` in the same PR.

The step summary's `### Secret sources` block shows each key as `sops`, `sops (differs from legacy)`, `github`,
`MISSING` or `absent (optional)`. A key that a target namespace overrides shows `sops (<namespace>)`, for example `sops (homelab)`, or
`sops (<namespace>; differs from legacy)`. A missing required key fails the deploy before anything is applied.

The DigitalOcean app is found by its spec `name:` (`xstockstrat-staging` / `xstockstrat-production`), so no app ID is stored anywhere.
`MTLS_CA` is one CA per environment, shared by DO and homelab. Staging and production still use different CAs.

## Key generation

Install the tools (macOS; on Linux, use the pinned release binaries from `.github/actions/setup-sops/action.yml`):

```bash
brew install sops age
```

Create three keys and keep them **outside the repo**. `*.agekey` and `keys.txt` are git-ignored as a safety net.

```bash
age-keygen -o ~/.config/sops/age/xstockstrat-staging.agekey
```

```bash
age-keygen -o ~/.config/sops/age/xstockstrat-production.agekey
```

```bash
age-keygen -o ~/.config/sops/age/xstockstrat-operator.agekey
```

Store a backup of each key in your password manager. Losing an environment key means re-bootstrapping that environment.

## Environment setup

```bash
gh secret set SOPS_AGE_KEY --env staging < ~/.config/sops/age/xstockstrat-staging.agekey
```

```bash
gh secret set SOPS_AGE_KEY --env production < ~/.config/sops/age/xstockstrat-production.agekey
```

```bash
gh variable set SOPS_OPERATOR_AGE_RECIPIENT --body "$(age-keygen -y ~/.config/sops/age/xstockstrat-operator.agekey)"
```

Preflight before the first deploy on the new workflows:

- `doctl apps list --format ID,Spec.Name` shows exactly one `xstockstrat-staging`, and its ID equals the current `DO_DEV_APP_ID`. Check `xstockstrat-production` the same way if prod is up.
- `gh secret list --env staging` and `gh secret list --env production` show no secret named `DEV_*`, `PROD_*` or `DIGITALOCEAN_ACCESS_TOKEN`. An environment secret with one of those names would shadow the repo secret.
- The environments' deployment-branch policies admit `main-dev` → `staging` and `main` → `production`.
- Homelab is either disabled (`vars.HOMELAB_STAGING_ENABLED` / `vars.HOMELAB_PRODUCTION_ENABLED` not `true`) or its environment secrets are set. 1Password is no longer read.
- `gh secret list --env staging` and `gh secret list --env production` show no `APP_ENV`. It is no longer read; delete it if present.

## Bootstrap

`sops-bootstrap.yml` seeds `common` and `digitalocean` from the current `DEV_*` / `PROD_*` repo secrets. GitHub only
dispatches workflows that exist on the default branch (`main`), so the order is:

1. Merge the feature to `main-dev`. The deploy still reads every key from `github`.
2. Promote to `main`.
3. Dispatch **SOPS bootstrap** from `main` with `force` unchecked. The staging job runs at once. The production job waits for the `production` environment's reviewers.
4. The run opens a PR from `chore/sops-bootstrap` to `main-dev`. It needs the `GH_PAT` secret, because a PR opened with `GITHUB_TOKEN` runs no CI. Review it, merge it, then promote.

After the merge, the summary shows `sops` for every key. If it shows `sops (differs from legacy)`, a legacy secret
changed after the bootstrap. Re-run the bootstrap with `force` checked. The PR body then lists every key as added, changed, unchanged
or removed, by name only.

The bootstrap refuses an environment whose file already exists on `main-dev` unless `force` is checked.
`force` re-seeds **both** files from the legacy secrets. To re-seed one environment later, edit it locally (next section).

## Local edit

```bash
SOPS_AGE_KEY_FILE=~/.config/sops/age/xstockstrat-operator.agekey sops secrets/staging.enc.yaml
```

`.sops.yaml` maps each file to its environment key plus the operator key, so new values are encrypted to both. Commit the
changed `secrets/<env>.enc.yaml` through a normal PR. Only the changed values' ciphertext changes in the diff.

## Rotation

Set one value without opening an editor:

```bash
SOPS_AGE_KEY_FILE=~/.config/sops/age/xstockstrat-operator.agekey sops set secrets/staging.enc.yaml '["common"]["SLACK_WEBHOOK_URL"]' '"https://hooks.example/new"'
```

Rotate the mTLS CA:

```bash
scripts/mtls-provision.sh ca dev
```

Write the printed bundle into `common.MTLS_CA` with `sops set`. Leaves are re-minted on every deploy.

Never rotate `CONFIG_SECRETS_ENCRYPTION_KEY` or `BROKER_ACCOUNTS_ENCRYPTION_KEY` this way. Data already encrypted under the old key
would become unreadable.

## Adding a key

1. Add one tuple to `KEYS` in `scripts/sops_secrets.py`. This is the only code edit.
2. Add the consumer: a `YOUR_DEV_<NAME>` / `YOUR_PROD_<NAME>` placeholder in `.do/app*.yaml`, and/or `${NAME}` in `deploy/homelab/compose.yml`.
3. Run `sops set` for the value in each environment file.
4. Add a row to the table at the top of this runbook.

A homelab-only `.env` key is one more `KEYS` row in the `homelab` namespace plus its `LEGACY_<NAME>: ${{ secrets.<NAME> }}` line in
`deploy-homelab.yml`. It reaches the VM `.env` automatically unless it is listed in `HOMELAB_EXPORTS` (CI-only keys). There is no map and no escape hatch.

## Homelab enablement

Before setting `HOMELAB_*_ENABLED=true`:

- `sops set` every `homelab.*` key, including the flat `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` and `DB_CA_CERT`. The CA is a public certificate; set it in **both** files
  (production is required too, even before production is enabled, because `DB_CA_CERT` is a required key):
  `sops set secrets/staging.enc.yaml '["homelab"]["DB_CA_CERT"]' "$(jq -Rs . < db-ca.pem)"`, with `db-ca.pem` from homelab-edge:
  `sops decrypt --extract '["db_tls_ca_crt"]' secrets/edge.sops.yaml`.
- A value that contains a single quote or a line break cannot be written to the homelab `.env`, and a value that contains the reserved heredoc
  delimiter is refused too; the deploy names the key it refuses and never a value.
- After the first homelab deploy, confirm the release is healthy (`gate status`). Also check that the `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` values survived
  the `GITHUB_ENV` hand-off intact, including any trailing newline.

## Production reviewer gate

Every production deploy, `prod-up.yml` run and production bootstrap job is bound to the `production` environment. Each one waits for that
environment's required reviewers before it can read `SOPS_AGE_KEY`.

## Legacy-secret removal

This is a follow-up, done only after every key reports `sops` in both environments for at least one deploy each. Then delete:

- the `DEV_*` / `PROD_*` copies of the `common` keys and `DO_DEV_PROJECT_ID` / `DO_PROD_PROJECT_ID`;
- `DO_DEV_APP_ID` / `DO_PROD_APP_ID`, which are already unused;
- the homelab environment secrets `TS_AUTHKEY`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID`, `DB_CA_CERT` and `MTLS_CA`, plus `vars.TS_AUTHKEY_EXPIRES`, and the retired `APP_ENV` (no longer read);
- `OP_SERVICE_ACCOUNT_TOKEN`, `vars.OP_VAULT`, `vars.OP_TOKEN_EXPIRES` and the 1Password items.

After deletion a missing key reports `MISSING` and fails closed, so nothing can silently fall back.
