Feature: config-keys-alias-removal
  As a platform engineer, I want the compatibility layer removed after a full release without regressions,
  so that the config server serves one spelling and the contract is structural.

  @AC-1 @FR-1
  Scenario: Snapshots carry only the stored spelling
    Given namespace "indicators" stores key "sandbox.timeout_ms" = 15000 and marker row "relative_keys_v1" exists
    When the config server builds the WatchConfig snapshot for namespace "indicators"
    Then the snapshot holds "sandbox.timeout_ms" = 15000
    And it holds no key "indicators.sandbox.timeout_ms"

  @AC-2 @FR-2
  Scenario: SetConfig updates exactly the stored row
    Given namespace "analysis" stores key "backtest.max_range_days" = 365
    When an admin calls SetConfig for namespace "analysis", key "backtest.max_range_days", value 730
    Then the stored row holds 730
    And the server source contains no "ambiguous config key spelling" error path

  @AC-3 @FR-3
  Scenario: The poller exception is gone
    Given the trading reconciliation poller sends SetConfig namespace "platform", key "platform.trading_state", value "REDUCE_ONLY"
    When the config server handles it
    Then it returns INVALID_ARGUMENT
    And the same poller sending key "trading_state" with value "REDUCE_ONLY" succeeds and the row "platform" / "trading_state" holds "REDUCE_ONLY"
    And the poller still cannot write "ACTIVE"

  @AC-4 @FR-4
  Scenario: The agent returns the server's values unfiltered
    Given the config server returns namespace "marketdata" values {"fmp.enabled": true}
    When the agent runs get_config for namespace "marketdata"
    Then it returns {"fmp.enabled": true} and applies no alias filter

  @AC-5 @FR-5
  Scenario: The gate has no form-mismatch kind
    Given the gate source after this feature
    When "node scripts/check-config-wiring.mjs --final" runs on a tree with a prefixed seed
    Then it fails with a database error from the real migrate up before the gate runs
    And the kinds "form-mismatch" and the alt/partner functions no longer exist in check-config-wiring.mjs

  @AC-6 @FR-6
  Scenario: The re-owned baseline entries are settled
    Given scripts/config-wiring.json holds seeded-unread entries owned by "feature 306" for platform / log_level, trading / risk.daily_loss_limit and ledger / stream.notify_enabled
    When this feature is code-completed
    Then all three entries are removed and context.md records the decision for each (reader added or row deleted)

  @AC-7 @FR-3
  Scenario: The earliest-start evidence is recorded
    Given Loki shows zero "SetConfig canonicalised internal-caller key" lines over one full staging release after feature 304 launched
    When the first implementation step starts
    Then context.md records the query, the window and the zero count
