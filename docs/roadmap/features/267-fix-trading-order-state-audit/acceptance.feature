Feature: fix-trading-order-state-audit (bug fix)
  Regression guard for docs/reports/2026-10-21-trading-order-state-audit-defect.md:
  trading discards UpsertOrder errors (D-04) and reactive ReclaimOrphanIntent results (D-62).

  @AC-1 @regression
  Scenario: A failed order-state write after a broker timeout is logged
    Given a trading repository whose UpsertOrder returns error "db unavailable"
    And a broker whose PlaceOrder returns context.DeadlineExceeded
    When user "u-1" places a buy 10 "AAPL" market order with client_order_id "c-1"
    Then an error-level log records the failed order write with the order id, user "u-1" and the attempted status

  @AC-2 @regression
  Scenario: A failed order-state write after a broker reject is logged
    Given a trading repository whose UpsertOrder returns error "db unavailable"
    And a broker whose PlaceOrder returns a rejection "insufficient buying power"
    When user "u-1" places a buy 10 "AAPL" market order
    Then an error-level log records the failed order write with the order id and status REJECTED

  @AC-3 @regression
  Scenario: Failed final writes in CancelOrder and ReplaceOrder are logged
    Given an open order "o-1" for user "u-1"
    And a trading repository whose UpsertOrder returns error "db unavailable"
    When user "u-1" cancels order "o-1"
    And user "u-1" replaces order "o-1" with limit price 101.00
    Then each call produces an error-level log naming order "o-1" and the failed write

  @AC-4 @regression
  Scenario: A reactive stale-intent reclaim is audited like a sweeper reclaim
    Given an order intent "c-1" for user "u-1" in PENDING last updated longer ago than the stale threshold
    When user "u-1" calls PlaceOrder again with client_order_id "c-1"
    Then the call returns FailedPrecondition "still pending"
    And the ledger receives an "order_intent.reclaimed_unknown" event for intent "c-1" whose trigger names the reactive path

  @AC-5 @regression
  Scenario: A failed reactive reclaim is logged
    Given an order intent "c-1" in PENDING older than the stale threshold
    And an order-intent repository whose ReclaimOrphanIntent returns error "db unavailable"
    When user "u-1" calls CancelOrder or ReplaceOrder with intent "c-1"
    Then a log records the failed reclaim with intent id "c-1"
