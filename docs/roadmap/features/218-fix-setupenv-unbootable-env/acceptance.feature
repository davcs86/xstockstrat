Feature: fix-setupenv-unbootable-env (bug fix)
  Regression guard for docs/reports/2026-10-02-setupenv-unbootable-env-defect.md:
  setup-env produces an .env that docker compose rejects.

  @AC-1 @regression
  Scenario: A defaults-mode setup produces a .env that docker compose accepts
    Given no .env file exists at the repo root
    When the operator runs "./scripts/setup-env.sh --defaults"
    Then the generated .env defines CONFIG_SECRETS_ENCRYPTION_KEY as 64 hex characters
    And the generated .env defines BROKER_ACCOUNTS_ENCRYPTION_KEY as 64 hex characters
    And "docker compose config" exits 0 using that .env

  @AC-2 @regression
  Scenario: A generated .env carries none of the variables removed by feature 147
    Given no .env file exists at the repo root
    When the operator runs "./scripts/setup-env.sh --defaults"
    Then the generated .env does not define ALPACA_API_KEY, ALPACA_API_SECRET or MCP_AGENT_SECRET
