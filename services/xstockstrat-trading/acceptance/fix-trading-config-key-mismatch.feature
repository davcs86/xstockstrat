# Promoted from docs/roadmap/features/192-fix-trading-config-key-mismatch/acceptance.feature at
# archive time (Constitution C-16 backfill — promotion was operator-deferred at launch). Source-feature
# provenance is carried on every scenario's `@feature-192` tag. Durable regression guards for the
# defect at docs/reports/2026-09-15-trading-config-namespace-key-mismatch-defect.md: the trading
# service must resolve the LIVE platform.trading_state (and configured trading.risk.* values) from
# config, not the fail-closed HALTED / hardcoded defaults — the getter's key string must match the key
# under which the value is actually delivered (CONFIG-9). A rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-trading-config-key-mismatch (bug fix — trading config read-path guarantees)
  Regression guard for the SEV-1 "trading halted" outage: the trading service resolves live config
  from the platform namespace against a correctly-keyed snapshot, rather than falling to fail-closed
  code defaults.

  @AC-1 @regression @feature-192
  Scenario: an order is accepted when the platform trading state is ACTIVE
    Given config-service holds platform.trading_state = "ACTIVE"
    And the trading service's config watcher has received the current snapshot
    When a user places an exposure-increasing market BUY with an explicit quantity
    Then the platform.trading_state gate does not reject the order
    And the order is not rejected with "trading halted: platform.trading_state=HALTED"

  @AC-2 @regression @feature-192
  Scenario: a live-set trading state is observed by the trading-state getter (read-path contract)
    Given the trading config watcher holds a snapshot in which platform.trading_state resolves to "REDUCE_ONLY"
    When currentTradingState() reads platform.trading_state
    Then it returns REDUCE_ONLY, not the fail-closed HALTED default

  @AC-3 @regression @feature-192
  Scenario: a trading.* risk key set in config is applied, not silently defaulted
    Given config-service holds a non-default value for a trading.risk.* key
    And the trading service's config watcher has received the current snapshot
    When the trading service reads that key
    Then it returns the configured value, not the hardcoded code default
