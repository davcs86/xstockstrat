Feature: fix-replace-tif-before-intent (bug fix)
  Regression guard for docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md:
  ReplaceOrder validated time-in-force after claiming its intent.

  @AC-1 @FR-1 @regression
  Scenario: A replace with a time-in-force the broker does not allow leaves nothing behind
    Given a NEW order on an IBKR account
    When its owner replaces it with time-in-force "OPG"
    Then the request is refused as an invalid argument
    And no replace intent is recorded for the order
    And the order's intent state is unchanged
    And no replace is sent to the broker
    And no intent-reclaim event is emitted for the order, however long the caller waits

  @AC-2 @FR-1 @regression
  Scenario: The caller can correct the time-in-force and retry
    Given a NEW order on an IBKR account whose replace with time-in-force "OPG" was refused
    When its owner sends the same replace with time-in-force "DAY"
    Then the replace is sent to the broker and succeeds
    And the refused request can be sent again and is refused as an invalid argument, not as pending or unknown

  @AC-3 @FR-2
  Scenario: An allowed replace still claims exactly one intent
    Given a NEW order on an IBKR account
    When its owner replaces it with time-in-force "DAY"
    Then exactly one replace intent is recorded for the order and it is completed
    And an identical replace returns the stored result without a second broker call
