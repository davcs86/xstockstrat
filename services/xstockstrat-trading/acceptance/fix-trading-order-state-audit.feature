# Promoted from docs/roadmap/features/267-fix-trading-order-state-audit/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-267` tag.
# Durable regression guards for the defect at docs/reports/2026-10-21-trading-order-state-audit-defect.md:
# trading must not silently discard UpsertOrder errors (D-04) or reactive ReclaimOrphanIntent results (D-62).
# A rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-trading-order-state-audit (bug fix)
  Regression guard for docs/reports/2026-10-21-trading-order-state-audit-defect.md:
  trading discards UpsertOrder errors (D-04) and reactive ReclaimOrphanIntent results (D-62).

  @AC-1 @FR-1 @regression @feature-267
  Scenario: A failed order-state write after a broker timeout is logged
    Given a trading repository whose UpsertOrder returns error "db unavailable"
    And a broker whose PlaceOrder returns context.DeadlineExceeded
    When user "u-1" places a buy 10 "AAPL" market order with client_order_id "c-1"
    Then an error-level log records the failed order write with the order id, user "u-1" and status ORDER_STATUS_NEW

  @AC-2 @FR-2 @regression @feature-267
  Scenario: A failed order-state write after a broker reject is logged
    Given a trading repository whose UpsertOrder returns error "db unavailable"
    And a broker whose PlaceOrder returns a rejection "insufficient buying power"
    When user "u-1" places a buy 10 "AAPL" market order
    Then an error-level log records the failed order write with the order id, user "u-1" and status ORDER_STATUS_REJECTED

  @AC-3 @FR-3 @regression @feature-267
  Scenario: A failed final write in CancelOrder is logged
    Given an open order "o-1" for user "u-1"
    And a trading repository whose UpsertOrder returns error "db unavailable"
    When user "u-1" cancels order "o-1"
    Then an error-level log records the failed order write for order "o-1", user "u-1" and status ORDER_STATUS_CANCELED

  @AC-6 @FR-4 @regression @feature-267
  Scenario: A failed final write in ReplaceOrder is logged
    Given an open limit order "o-1" for user "u-1"
    And a trading repository whose UpsertOrder returns error "db unavailable"
    When user "u-1" replaces order "o-1" with limit price 101.00
    Then an error-level log records the failed order write for order "o-1" and user "u-1"

  @AC-4 @FR-5 @regression @feature-267
  Scenario: A reactive stale-intent reclaim is audited like a sweeper reclaim
    Given an order intent "c-1" for user "u-1" in PENDING last updated longer ago than the stale threshold
    When user "u-1" calls PlaceOrder again with client_order_id "c-1"
    Then the call returns FailedPrecondition "still pending"
    And the ledger receives an "order_intent.reclaimed_unknown" event for intent "c-1" with trigger "reactive_place"

  @AC-5 @FR-6 @regression @feature-267
  Scenario: A failed reactive reclaim in CancelOrder is logged
    Given an open order "o-1" for user "u-1" with a cancel intent in PENDING older than the stale threshold
    And an order-intent repository whose ReclaimOrphanIntent returns error "db unavailable"
    When user "u-1" cancels order "o-1"
    Then the call returns FailedPrecondition "still pending"
    And a log records the failed reclaim with the cancel intent id and error "db unavailable"

  @AC-7 @FR-6 @regression @feature-267
  Scenario: A failed reactive reclaim in ReplaceOrder is logged
    Given an open limit order "o-1" for user "u-1" with a replace intent in PENDING older than the stale threshold
    And an order-intent repository whose ReclaimOrphanIntent returns error "db unavailable"
    When user "u-1" replaces order "o-1" with limit price 101.00
    Then the call returns FailedPrecondition "still pending"
    And a log records the failed reclaim with the replace intent id and error "db unavailable"

  @AC-8 @FR-5 @regression @feature-267
  Scenario: A reactive stale-intent reclaim in CancelOrder is audited
    Given an open order "o-1" for user "u-1" with a cancel intent in PENDING older than the stale threshold
    When user "u-1" cancels order "o-1"
    Then the call returns FailedPrecondition "still pending"
    And the ledger receives an "order_intent.reclaimed_unknown" event for order "o-1" with trigger "reactive_cancel"

  @AC-9 @FR-5 @regression @feature-267
  Scenario: A reactive stale-intent reclaim in ReplaceOrder is audited
    Given an open limit order "o-1" for user "u-1" with a replace intent in PENDING older than the stale threshold
    When user "u-1" replaces order "o-1" with limit price 101.00
    Then the call returns FailedPrecondition "still pending"
