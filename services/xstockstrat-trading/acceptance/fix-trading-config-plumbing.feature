# Promoted from docs/roadmap/features/321-fix-trading-config-plumbing/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-321` tag.
# Durable regression guards for three xstockstrat-trading config/persistence defects: the IBKR signed-request
# timeout, the int-typed retry rows, and requires_approval persistence. A rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-trading-config-plumbing (bug fix, trading config and persistence guarantees)
  Regression guard for three xstockstrat-trading defect reports (IBKR timeout, accessor type
  mismatch, requires_approval persistence).

  # guards: docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md
  @AC-1 @regression @feature-321
  Scenario: Signed IBKR requests honour the live trading.broker.timeout_ms
    Given trading.broker.timeout_ms is 2000
    And an IBKR account whose order endpoint never answers
    When an order is placed for that account
    Then the signed order request times out after about 2 seconds, not 10
    And a later change of trading.broker.timeout_ms applies to the same broker client without a restart
    And a handshake slower than trading.broker.timeout_ms but within trading.ibkr.handshake_timeout_ms still succeeds

  # guards: docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md
  @AC-2 @regression @feature-321
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
  @AC-3 @regression @feature-321
  Scenario: An order that crosses the approval threshold is persisted with requires_approval true
    Given trading.approval.require_above_qty is 20
    When an order with qty 21 is placed and returns ORDER_STATUS_PENDING_APPROVAL
    Then the trading.orders row first written for that order_id has requires_approval = true
    And an order written with any other status has requires_approval = false
