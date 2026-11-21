Feature: fix-trading-config-plumbing (bug fix)
  Regression guard for four trading config/persistence defect reports (IBKR timeout, accessor type
  mismatch, requires_approval persistence, trading.broker.paper seeding).
  Scenarios amended at design approval (2026-11-20, design.md § Spec amendments); IDs unchanged.

  # guards: docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md
  @AC-1 @regression
  Scenario: Signed IBKR requests honour the live trading.broker.timeout_ms
    Given trading.broker.timeout_ms is 2000
    And an IBKR account whose order endpoint never answers
    When an order is placed for that account
    Then the signed order request times out after about 2 seconds, not 10
    And a later change of trading.broker.timeout_ms applies to the same broker client without a restart
    And a handshake slower than trading.broker.timeout_ms but within trading.ibkr.handshake_timeout_ms still succeeds

  # guards: docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md
  @AC-2 @regression
  Scenario Outline: An int-typed trading.order.max_retries row sets the emergency flatten's attempts
    Given trading.order.max_retries is stored as an int row with value <max_retries>
    And trading.order.retry_delay_ms is stored as an int row below its 500 ms default
    When every broker submission of a protection-window flatten is definitively rejected
    Then the flatten submits <attempts> times, which is 1 + max_retries, before halting the account
    And it waits the stored retry delay between attempts, not the default

    Examples:
      | max_retries | attempts |
      | 1           | 2        |
      | 5           | 6        |

  # guards: docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md
  @AC-3 @regression
  Scenario: An order that crosses the approval threshold is persisted with requires_approval true
    Given trading.approval.require_above_qty is 20
    When an order with qty 21 is placed and returns ORDER_STATUS_PENDING_APPROVAL
    Then the trading.orders row first written for that order_id has requires_approval = true
    And an order written with any other status has requires_approval = false

  # guards: docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md
  @AC-4 @regression
  Scenario: trading.broker.paper is seeded per environment and falls back to the application environment
    Given the config catalog row for trading.broker.paper has an environment-derived default
    When the config seed migrations run for staging and production
    Then trading.broker.paper is stored true in staging and false in production, never one literal for both
    And a row that already exists is left unchanged
    And with no stored row trading resolves paper unless APPLICATION_ENV is production, whatever TRADING_MODE says
    And staging resolves to paper and production resolves to live
    And scripts/config-wiring.json holds no entry for trading.broker.paper and "node scripts/check-config-wiring.mjs --final" exits 0 with no read-unseeded or STALE line for it
