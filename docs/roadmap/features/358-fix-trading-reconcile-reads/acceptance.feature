Feature: fix-trading-reconcile-reads (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md: trading reconcile reads only the first 500 platform positions per account.

  @AC-1 @FR-1 @FR-4 @regression
  Scenario: Reconcile does not flag a held position that sits past the first 500
    Given broker account "acc-1" holds 501 positions "SYM001" through "SYM501", each with quantity 10
    And the platform projection for "acc-1" holds the same 501 symbols, each with quantity 10
    And the portfolio ListPositions fake returns "SYM001".."SYM500" on page 1 with next_page_token "p2", and "SYM501" on page 2 with an empty next_page_token
    And NetFilledQtyBySymbol returns no filled quantity for "SYM501"
    When reconcileTick runs for graceTicks plus one ticks
    Then no quantity-discrepancy finding is emitted for "acc-1"
    And "acc-1" is not halted

  @AC-2 @FR-2 @regression
  Scenario: A page error while reading platform positions skips the account for the tick
    Given broker account "acc-1" holds 501 positions "SYM001" through "SYM501", each with quantity 10
    And the portfolio ListPositions fake returns "SYM001".."SYM500" on page 1 with next_page_token "p2" and returns an Unavailable error for page 2
    And NetFilledQtyBySymbol returns no filled quantity for "SYM501"
    When reconcileTick runs for graceTicks plus one ticks
    Then no reconciliation candidate is recorded for "acc-1"
    And no quantity-discrepancy finding is emitted for "acc-1"
    And "acc-1" is not halted

  @AC-3 @FR-3 @regression
  Scenario: Reconcile treats a repeated next_page_token as a failed read
    Given broker account "acc-1" holds 501 positions "SYM001" through "SYM501", each with quantity 10
    And the portfolio ListPositions fake ignores page_token and returns "SYM001".."SYM500" with next_page_token "p2" on every call
    And NetFilledQtyBySymbol returns no filled quantity for "SYM501"
    When reconcileTick runs for graceTicks plus one ticks
    Then each tick makes at most 2 ListPositions calls for "acc-1"
    And no reconciliation candidate is recorded for "acc-1"
    And no quantity-discrepancy finding is emitted for "acc-1"
    And "acc-1" is not halted
