Feature: sops-secrets-migration
  As the platform operator, I want deploy-time secrets in per-environment SOPS (age) files with the
  decryption key in each GitHub Environment, bootstrapped from today's values, so that secrets are
  versioned, reviewable, and rotatable without service disruption.

  @AC-1 @FR-1 @FR-2
  Scenario: Each environment key decrypts only its own file
    Given secrets/staging.enc.yaml and secrets/production.enc.yaml produced by the bootstrap
    And the staging SOPS_AGE_KEY and the production SOPS_AGE_KEY
    When "sops -d secrets/production.enc.yaml" runs with only the staging key
    Then it exits non-zero with "no matching keys" and no value is printed
    And "sops -d secrets/staging.enc.yaml" with only the staging key exits 0
    And each file's sops.age metadata lists exactly 2 recipients: the env key and SOPS_OPERATOR_AGE_RECIPIENT

  @AC-2 @FR-1 @FR-3 @FR-4
  Scenario: Keys land in exactly one of common, digitalocean, homelab
    Given DEV_JWT_SECRET="jwt-do", DO_DEV_PROJECT_ID="proj-9", and the staging env secret TS_AUTHKEY="tskey-x"
    When the bootstrap runs for staging
    Then the decrypted file has common.JWT_SECRET="jwt-do" and digitalocean.PROJECT_ID="proj-9"
    And the file has no homelab namespace, and "tskey-x" appears nowhere in it
    And DIGITALOCEAN_ACCESS_TOKEN, GH_PAT, BUF_TOKEN and any APP_ID appear in no namespace

  # @AC-19 RETIRED 2026-11-03 (operator): the bootstrap no longer reads homelab sources (1Password/env
  # secrets) and no longer reconciles homelab values. ID kept, never reused (append-only).

  @AC-20 @FR-4 @FR-5
  Scenario: Bootstrap seeds only common and digitalocean
    Given the staging environment holds homelab secrets TS_AUTHKEY and APP_ENV
    When the bootstrap runs for staging
    Then the job succeeds and the decrypted file's top-level keys are exactly "common" and "digitalocean"

  # @AC-3 RETIRED 2026-11-03 (operator): the bootstrap no longer reads homelab sources (1Password/env
  # secrets) and no longer reconciles homelab values. ID kept, never reused (append-only).

  # @AC-4 RETIRED 2026-11-03 (operator): the bootstrap no longer reads homelab sources (1Password/env
  # secrets) and no longer reconciles homelab values. ID kept, never reused (append-only).

  @AC-5 @FR-4 @FR-7
  Scenario: The homelab APP_ENV is rendered so compose reads every value literally
    Given homelab.app_env = {APP_URL: "https://x.example", DB_PASSWORD: "p$w #1 \"x\""} and common.JWT_SECRET="j$t"
    When deploy-homelab.yml renders the release .env for staging
    Then `docker compose config` resolves DB_PASSWORD to exactly "p$w #1 \"x\"" and JWT_SECRET to exactly "j$t"
    And common keys are rendered after app_env keys

  @AC-6 @FR-5
  Scenario: Bootstrap never leaks plaintext and fails on a missing required value
    Given PROD_JWT_SECRET is unset and no other source holds it
    When the bootstrap runs for production
    Then the job fails with "JWT_SECRET is required but missing" before any commit or push
    And no plaintext value appears in the job log, any uploaded artifact, or the runner cache

  @AC-7 @FR-5
  Scenario: Successful bootstrap opens a single PR to main-dev
    Given both matrix jobs succeed
    When the bootstrap finishes
    Then branch chore/sops-bootstrap contains .sops.yaml, secrets/staging.enc.yaml and secrets/production.enc.yaml
    And one PR from chore/sops-bootstrap targets main-dev, authored with GH_PAT
    And every value in the committed files starts with "ENC[AES256_GCM,"

  @AC-8 @FR-6
  Scenario: DO deploy with no SOPS file yet behaves exactly as today
    Given secrets/staging.enc.yaml does not exist and DEV_JWT_SECRET="jwt-gh"
    When deploy-dev.yml deploys staging
    Then the substituted app spec carries JWT_SECRET "jwt-gh"
    And the step summary lists "JWT_SECRET: github" for every key

  @AC-9 @FR-6
  Scenario: DO deploy prefers SOPS and falls back per key
    Given secrets/production.enc.yaml has common.JWT_SECRET="jwt-sops" and no SENDGRID_API_KEY
    And PROD_JWT_SECRET="jwt-gh" and PROD_SENDGRID_API_KEY="sg-gh"
    When deploy-prod.yml deploys production
    Then the app spec carries JWT_SECRET "jwt-sops" and SENDGRID_API_KEY "sg-gh"
    And the step summary lists "JWT_SECRET: sops" and "SENDGRID_API_KEY: github"
    And the log shows "***" wherever either value would appear

  @AC-10 @FR-6
  Scenario: DO deploy fails closed only when a required key is in neither store
    Given CONFIG_SECRETS_ENCRYPTION_KEY is in neither secrets/staging.enc.yaml nor DEV_CONFIG_SECRETS_ENCRYPTION_KEY
    When deploy-dev.yml deploys staging
    Then the job fails with "CONFIG_SECRETS_ENCRYPTION_KEY is in neither SOPS nor the GitHub secrets"
    And the DO app's active deployment ID is unchanged after the run

  @AC-11 @FR-6 @FR-9
  Scenario: Prod bring-up resolves secrets the same way
    Given secrets/production.enc.yaml has common.JWT_SECRET="jwt-sops"
    When prod-up.yml runs with no existing prod app
    Then /tmp/app.yaml carries JWT_SECRET "jwt-sops"

  @AC-12 @FR-7
  Scenario: Homelab deploy no longer touches 1Password
    Given secrets/staging.enc.yaml has common.MTLS_CA and the full homelab namespace
    When deploy-homelab.yml deploys staging
    And OP_SERVICE_ACCOUNT_TOKEN is unset for the staging environment
    Then the deploy succeeds and the VM reports the new release as healthy
    And the step summary lists "sops" for TS_AUTHKEY, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, APP_ENV and MTLS_CA
    And the release .env passed to the VM contains APP_URL from homelab.app_env

  @AC-13 @FR-7
  Scenario: Homelab deploy falls back to the GitHub environment secret per key
    Given secrets/staging.enc.yaml lacks homelab.DEPLOY_KNOWN_HOSTS and the env secret DEPLOY_KNOWN_HOSTS is set
    When deploy-homelab.yml deploys staging
    Then the step summary lists "DEPLOY_KNOWN_HOSTS: github" and the deploy proceeds

  @AC-17 @FR-11
  Scenario: Deploy targets the app resolved by spec name, even after a prod recreate
    Given prod-up.yml recreated the prod app, so "xstockstrat-production" now has ID "app-new"
    And the legacy secret DO_PROD_APP_ID still holds the deleted ID "app-old"
    When deploy-prod.yml deploys production
    Then app "app-new" receives the new deployment, and the step summary shows "app: xstockstrat-production → app-new"

  @AC-21 @FR-11
  Scenario: Deploy fails closed when the app name does not resolve to exactly one app
    Given no DigitalOcean app named "xstockstrat-staging" exists
    When deploy-dev.yml deploys staging
    Then the job fails with "expected exactly 1 app named xstockstrat-staging, found 0"
    And no app is updated

  @AC-18 @FR-10 @FR-7
  Scenario: Homelab mints its mTLS leaves from the shared common CA
    Given common.MTLS_CA="caDO" in secrets/staging.enc.yaml
    When deploy-homelab.yml builds the release .env for staging
    Then MTLS_CA_CERT in the release .env is the CA certificate decoded from "caDO"

  @AC-14 @FR-8
  Scenario: Runbook covers the full operator lifecycle
    Given docs/runbooks/sops-secrets.md
    When an operator follows it from scratch
    Then it has sections for key generation, environment setup, bootstrap, local edit, rotation, adding a key and legacy-secret removal
    And every command is macOS/Homebrew-compatible (brew install sops age)

  @AC-15 @FR-5
  Scenario: Bootstrap refuses to overwrite an existing SOPS file without force
    Given secrets/staging.enc.yaml exists on main-dev
    When the bootstrap is dispatched with force=false
    Then the staging job fails with "secrets/staging.enc.yaml already exists; re-run with force=true to overwrite"
    And no branch is pushed

  @AC-16 @FR-9
  Scenario: Prod bring-up injects the full key set including VAPID and mTLS
    Given secrets/production.enc.yaml has common.VAPID_PUBLIC_KEY="BPub" and common.MTLS_CA set
    When prod-up.yml runs with no existing prod app
    Then /tmp/app.yaml contains "BPub" and no "YOUR_PROD_VAPID_" or "YOUR_PROD_MTLS_" placeholder remains

  @AC-22 @FR-6
  Scenario: A same-named environment secret cannot shadow the DigitalOcean fallback
    Given secrets/staging.enc.yaml does not exist, DEV_MTLS_CA="caDO", and the staging environment holds a secret MTLS_CA="caOther"
    When deploy-dev.yml deploys staging
    Then the minted leaves verify against the CA decoded from "caDO"
    And the step summary lists "MTLS_CA: github"

  @AC-23 @FR-4 @FR-7
  Scenario: Homelab app_env may not carry a common key
    Given secrets/staging.enc.yaml has common.JWT_SECRET="jwt-do" and homelab.app_env.JWT_SECRET="jwt-x"
    When deploy-homelab.yml resolves staging
    Then the job fails with "homelab.app_env must not contain common key JWT_SECRET"
    And neither value appears in the log
