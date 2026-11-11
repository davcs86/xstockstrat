Feature: fix-trading-config-plumbing (bug fix)
  Regression guard for four trading config/persistence defect reports (IBKR timeout, accessor type
  mismatch, requires_approval persistence, trading.broker.paper seeding).

  # guards: docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md
  @AC-1 @regression
  Scenario: IBKR broker calls honour trading.broker.timeout_ms
    Given trading.broker.timeout_ms is 2000
    And an IBKR account whose base URL points at a black-holed host
    When an order is placed for that account
    Then each IBKR HTTP call times out after about 2 seconds, not 10

  # guards: docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md
  @AC-2 @regression
  Scenario: An int-typed trading.order.max_retries row is honoured by the emergency flatten
    Given trading.order.max_retries is set to 3 with value_type int
    When a protection-window flatten's broker submission fails transiently
    Then the flatten retries the submission up to 3 times before halting

  # guards: docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md
  @AC-3 @regression
  Scenario: An order that crosses the approval threshold is persisted with requires_approval true
    Given trading.approval.require_above_qty is 500
    When an order with qty 501 is placed and returns ORDER_STATUS_PENDING_APPROVAL
    Then the trading.orders row for that order_id has requires_approval = true

  # guards: docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md
  @AC-4 @regression
  Scenario: trading.broker.paper is never seeded with one literal for both environments
    Given the config catalog row for trading.broker.paper has an environment-derived default
    When the config seed/heal migrations run for staging and production
    Then no single literal value is written for trading.broker.paper in both environments
    And staging resolves to paper and production resolves to live
