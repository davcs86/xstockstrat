Feature: flatten-homelab-app-env
  As the operator who edits secrets/<env>.enc.yaml, I want each homelab .env value to be its own named,
  required key under homelab, so that a missing value fails the deploy by name and every value shows
  its source in the step summary.

  @AC-1 @FR-1 @FR-2
  Scenario: The three flat homelab keys resolve from SOPS and are reported one by one
    Given secrets/staging.enc.yaml holds homelab.DB_PASSWORD="pw-sops", homelab.APP_URL="https://stg.example.test:8443" and homelab.SEED_USER_ID="80880990-2b79-4d85-8761-d8d9102c2efb", plus every other required key
    When the homelab resolver runs for staging
    Then the step summary lists "DB_PASSWORD: sops", "APP_URL: sops" and "SEED_USER_ID: sops"
    And the step summary has no line for "app_env"

  @AC-2 @FR-3
  Scenario: APP_ENV is the three flat keys in table order, then the common tail
    Given the file from AC-1 and common.JWT_SECRET="jwt-do", common.BROKER_ACCOUNTS_ENCRYPTION_KEY="brk-sops", common.CONFIG_SECRETS_ENCRYPTION_KEY="cfg-sops"
    When the homelab resolver runs for staging
    Then the exported APP_ENV is exactly "DB_PASSWORD='pw-sops'", "APP_URL='https://stg.example.test:8443'", "SEED_USER_ID='80880990-2b79-4d85-8761-d8d9102c2efb'", "JWT_SECRET='jwt-do'", "BROKER_ACCOUNTS_ENCRYPTION_KEY='brk-sops'", "CONFIG_SECRETS_ENCRYPTION_KEY='cfg-sops'", one per line, in that order

  @AC-3 @FR-2
  Scenario: A flat key falls back to the same-named environment secret
    Given homelab.DB_PASSWORD is absent from secrets/staging.enc.yaml and the environment secret DB_PASSWORD="pw-gh" is provided as LEGACY_DB_PASSWORD
    When the homelab resolver runs for staging
    Then the step summary lists "DB_PASSWORD: github"
    And the exported APP_ENV contains the line "DB_PASSWORD='pw-gh'"

  @AC-4 @FR-2
  Scenario: A missing flat key fails the deploy by name before anything is exported
    Given neither secrets/staging.enc.yaml nor the environment secrets hold APP_URL
    When the homelab resolver runs for staging
    Then it exits 1 with "APP_URL is in neither SOPS nor the GitHub secrets"
    And the GitHub env file stays empty

  @AC-5 @FR-4
  Scenario: The legacy APP_ENV blob is no longer read
    Given the environment secret APP_ENV="DB_PASSWORD=old" is provided as LEGACY_APP_ENV and secrets/staging.enc.yaml holds homelab.DB_PASSWORD="pw-sops"
    When the homelab resolver runs for staging
    Then the exported APP_ENV contains "DB_PASSWORD='pw-sops'" and no occurrence of "old"
    And the step summary has no line for "app_env"

  @AC-6 @FR-5
  Scenario: A stale nested app_env map is refused, not ignored
    Given secrets/staging.enc.yaml still holds homelab.app_env as a map with APP_URL="https://x.example"
    When the homelab resolver runs for staging
    Then it exits 1 with "homelab.app_env must be a string"
    And the GitHub env file stays empty

  @AC-7 @FR-3
  Scenario: A value the homelab .env cannot hold is refused by key name
    Given secrets/staging.enc.yaml holds homelab.DB_PASSWORD="pw'x"
    When the homelab resolver runs for staging
    Then it exits 1 with "DB_PASSWORD: value contains a quote or newline, which the homelab .env cannot hold"
    And the message does not contain "pw'x"

  @AC-8 @FR-4
  Scenario: The workflow carries exactly the LEGACY_ lines the KEYS table requires
    Given the KEYS table has homelab rows DB_PASSWORD, APP_URL and SEED_USER_ID
    When the workflow-consistency check reads .github/workflows/deploy-homelab.yml
    Then the workflow provides LEGACY_DB_PASSWORD, LEGACY_APP_URL and LEGACY_SEED_USER_ID from the same-named environment secrets
    And the workflow has no LEGACY_APP_ENV

  @AC-9 @FR-3
  Scenario: The release .env built from the flat keys still renders under compose
    Given the resolver output from AC-2 and a CA bundle for staging
    When scripts/homelab-release-env.sh builds the release .env and "docker compose config" renders deploy/homelab/compose.yml with it
    Then compose exits 0 with no missing-variable error
    And db-migrator receives SEED_USER_ID="80880990-2b79-4d85-8761-d8d9102c2efb"

  @AC-10 @FR-6
  Scenario: The runbook and the durable suite describe the flat layout
    Given the repository after this feature
    When "app_env" is searched for in docs/runbooks/sops-secrets.md and docs/sdd/business-rules/platform.feature
    Then there is no match
    And the runbook's homelab row lists DB_PASSWORD, APP_URL and SEED_USER_ID
