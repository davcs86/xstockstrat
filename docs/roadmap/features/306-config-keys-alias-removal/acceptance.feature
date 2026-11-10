Feature: config-keys-alias-removal
  As a platform engineer, I want the compatibility layer removed after a full release without regressions,
  so that the config server serves one spelling and the contract is structural.

  @AC-1 @FR-1
  Scenario: Snapshots carry only the stored spelling
    Given namespace "indicators" stores key "sandbox.timeout_ms" = 15000 and marker row "relative_keys_v1" exists
    When the config server builds the WatchConfig snapshot for namespace "indicators"
    Then the snapshot holds "sandbox.timeout_ms" = 15000
    And it holds no key "indicators.sandbox.timeout_ms"
    And GetConfig for "indicators" returns "sandbox.timeout_ms" = 15000 and no "indicators.sandbox.timeout_ms"
    And a later SetConfig of "sandbox.timeout_ms" emits a delta with only the stored key
    And no snapshot re-sync is triggered by the marker row

  @AC-2 @FR-2
  Scenario: SetConfig updates exactly the stored row
    Given namespace "analysis" stores key "backtest.max_range_days" = 365
    When an admin calls SetConfig for namespace "analysis", key "backtest.max_range_days", value 730
    Then the stored row holds 730
    And SetConfig for namespace "analysis", key "analysis.backtest.max_range_days" is rejected with INVALID_ARGUMENT
    And no row "analysis" / "analysis.backtest.max_range_days" exists afterwards

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
    Given a tree whose service reads key "analysis.opportunity.refresh_hour_utc" while the stored key is "opportunity.refresh_hour_utc"
    When "node scripts/check-config-wiring.mjs --final" runs
    Then the finding is reported as an ordinary unseeded read and not as "form-mismatch"
    And a scripts/config-wiring.json entry of kind "form-mismatch" fails baseline validation

  @AC-6 @FR-6
  Scenario: The re-owned baseline entries are settled
    Given scripts/config-wiring.json holds seeded-unread entries owned by "feature 306" for platform / log_level, trading / risk.daily_loss_limit and ledger / stream.notify_enabled
    When this feature is code-completed
    Then all three entries are removed and the config migration has deleted the three rows with a snapshot and one audit row each
    And ListKeys for namespaces "platform", "trading" and "ledger" no longer lists "log_level", "risk.daily_loss_limit" or "stream.notify_enabled"
    And context.md records the operator's delete decision and the C-16 sign-off for the edited scenarios of 295 @AC-15 and 304 @AC-12

  @AC-7 @FR-3
  Scenario: The earliest-start evidence is recorded
    Given Loki shows zero "SetConfig canonicalised internal-caller key" lines over one full staging release after feature 304 launched
    When the first implementation step starts
    Then context.md records the query, the window and the zero count
