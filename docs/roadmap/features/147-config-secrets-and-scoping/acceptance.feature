Feature: config-secrets-and-scoping
  As a platform operator, I want secrets stored encrypted in config and config scoped by
  environment and user, so that secret plaintext is never exposed at any consumer edge and I can
  override configuration per user.

  @AC-1 @FR-1 @FR-4
  Scenario: A secret written via SetConfig is persisted encrypted, not plaintext
    Given the config service holds the master key "CONFIG_SECRETS_ENCRYPTION_KEY"
    And an admin caller writes SetConfig for key "marketdata.fmp.api_key" with is_secret=true and plaintext value "fmp-live-abc123"
    When the row is read directly from config.config_values in the database
    Then the stored ciphertext column does not contain the substring "fmp-live-abc123"
    And decrypting the ciphertext with the master key yields exactly "fmp-live-abc123"

  @AC-2 @FR-2
  Scenario: WatchConfig never streams secret plaintext
    Given "marketdata.fmp.api_key" is stored as an encrypted secret with plaintext "fmp-live-abc123"
    When a service subscribes to WatchConfig for namespace "marketdata"
    Then the snapshot value for "marketdata.fmp.api_key" has is_secret=true
    And its value carries the redaction sentinel, not "fmp-live-abc123"

  @AC-3 @FR-2
  Scenario: GetConfig and ListKeys redact secrets at the edge
    Given "marketdata.fmp.api_key" is stored as an encrypted secret with plaintext "fmp-live-abc123"
    When an operator calls GetConfig and ListKeys for namespace "marketdata"
    Then neither response contains "fmp-live-abc123"
    And the "marketdata.fmp.api_key" entry is marked is_secret=true with a redacted value

  @AC-4 @FR-3
  Scenario: An allow-listed internal caller resolves a secret via GetSecret
    Given "marketdata.fmp.api_key" is stored as an encrypted secret with plaintext "fmp-live-abc123"
    And the GetSecret allow-list grants caller "marketdata" the key "marketdata.fmp.api_key"
    When "marketdata" calls GetSecret for "marketdata.fmp.api_key" in environment "production" with x-internal-caller="marketdata"
    Then the response plaintext equals "fmp-live-abc123"

  @AC-5 @FR-3
  Scenario: GetSecret fails closed for a caller not on the allow-list
    Given "marketdata.fmp.api_key" is stored as an encrypted secret
    When a caller without an allow-listed x-internal-caller grant calls GetSecret for "marketdata.fmp.api_key"
    Then the call is rejected with PERMISSION_DENIED
    And no plaintext is returned

  @AC-6 @FR-5
  Scenario: marketdata resolves a vendor credential from config, not the env var
    Given ALPACA_API_KEY is unset in the marketdata process environment
    And "marketdata.alpaca.api_key" is stored as an encrypted secret with plaintext "alpaca-key-xyz"
    When marketdata starts and initializes its Alpaca client in environment "production"
    Then marketdata resolves the key "alpaca-key-xyz" via GetSecret
    And marketdata makes no read of os environment variable "ALPACA_API_KEY"

  @AC-7 @FR-6
  Scenario: A missing Alpaca credential warns but marketdata still starts
    Given environment "production" has no stored value for "marketdata.alpaca.api_key"
    When marketdata starts and resolves the credential via GetSecret
    Then marketdata logs the same looksLikePlaceholderCred warning it logged when the env var was empty
    And marketdata still starts (cached reads and non-Alpaca paths keep working), exactly as today

  @AC-8 @FR-7
  Scenario: MCP_AGENT_SECRET is absent from the codebase and deploy surfaces
    Given the feature branch is checked out
    When the repository is grepped for "MCP_AGENT_SECRET"
    Then there are no matches in service code, docker-compose.yml, .do/app.yaml, .do/app.dev.yaml, the deploy workflows, or do-inject-prod-secrets.py

  @AC-9 @FR-7
  Scenario: The agent OAuth txn round-trips signed with JWT_SECRET
    Given the agent OAuth server signs its stateless txn blob with JWT_SECRET
    When an OAuth authorization flow issues a txn and then verifies it on the callback
    Then the txn signature verifies successfully
    And a txn tampered by one byte is rejected
    And a txn signed with a different key is rejected

  @AC-10 @FR-8
  Scenario: Config messages carry environment production/staging and no trading_mode
    Given the regenerated proto stubs
    When a service builds a WatchConfigRequest
    Then it can set environment to ENVIRONMENT_STAGING or ENVIRONMENT_PRODUCTION
    And the WatchConfigRequest has no trading_mode field

  @AC-11 @FR-9
  Scenario: A per-user config value overrides the global value
    Given global "portfolio.watchlist.max_per_user" = 50 in environment "production"
    And a per-user value of 200 for user "u-123" for the same key and environment
    When user "u-123" resolves the key via GetConfig with x-user-id="u-123"
    Then the resolved value is 200
    And a different user "u-999" resolving the same key gets 50

  @AC-12 @FR-10
  Scenario: Existing trading_mode rows collapse deterministically onto their environment
    Given a pre-migration row "platform.trading_state" for (environment=production, trading_mode=live) with value "HALTED"
    And a row for (environment=production, trading_mode=all) with value "ACTIVE"
    When the scope-remodel migration runs
    Then production resolves "platform.trading_state" to the documented winner "HALTED"
    And no trading_mode column remains on config.config_values
