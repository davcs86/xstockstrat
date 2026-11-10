# Promoted from docs/roadmap/features/306-config-keys-alias-removal/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-306` tag.
# Durable business rules xstockstrat-config guarantees after the alias removal: one stored spelling is served, SetConfig touches exactly the stored row, and the internal-caller grant matches the exact relative key.
# Not promoted (one-time): 306 @AC-6 (three named-row deletion), @AC-7 (earliest-start evidence). The agent and platform-gate rules are in their own suites.

Feature: xstockstrat-config - one stored spelling, no compatibility alias
  What xstockstrat-config guarantees: snapshots and reads carry only the stored key, a write updates exactly its row and a prefixed key is rejected, and the internal-caller poller grant matches only the relative key.

  @AC-1 @FR-1 @feature-306
  Scenario: Snapshots carry only the stored spelling
    Given namespace "indicators" stores key "sandbox.timeout_ms" = 15000 and marker row "relative_keys_v1" exists
    When the config server builds the WatchConfig snapshot for namespace "indicators"
    Then the snapshot holds "sandbox.timeout_ms" = 15000
    And it holds no key "indicators.sandbox.timeout_ms"
    And GetConfig for "indicators" returns "sandbox.timeout_ms" = 15000 and no "indicators.sandbox.timeout_ms"
    And a later SetConfig of "sandbox.timeout_ms" emits a delta with only the stored key
    And no snapshot re-sync is triggered by the marker row

  @AC-2 @FR-2 @feature-306
  Scenario: SetConfig updates exactly the stored row
    Given namespace "analysis" stores key "backtest.max_range_days" = 365
    When an admin calls SetConfig for namespace "analysis", key "backtest.max_range_days", value 730
    Then the stored row holds 730
    And SetConfig for namespace "analysis", key "analysis.backtest.max_range_days" is rejected with INVALID_ARGUMENT
    And no row "analysis" / "analysis.backtest.max_range_days" exists afterwards

  @AC-3 @FR-3 @feature-306
  Scenario: The poller exception is gone
    Given the trading reconciliation poller sends SetConfig namespace "platform", key "platform.trading_state", value "REDUCE_ONLY"
    When the config server handles it
    Then it returns INVALID_ARGUMENT
    And the same poller sending key "trading_state" with value "REDUCE_ONLY" succeeds and the row "platform" / "trading_state" holds "REDUCE_ONLY"
    And the poller still cannot write "ACTIVE"
