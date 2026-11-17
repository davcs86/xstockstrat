Feature: fix-trading-reconcile-reads (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md: trading reconcile reads only the first 500 platform positions per account.

  @AC-1 @regression
  Scenario: Reconcile does not flag a held position that sits past the first 500
    Given broker account "acc-1" holds 501 positions and the platform projection holds the same 501 with equal quantities
    And the portfolio ListPositions fake pages at 500 with a non-empty next_page_token
    And NetFilledQtyBySymbol does not explain the 501st symbol
    When reconcileTick runs for graceTicks plus one ticks
    Then no quantity-discrepancy finding is emitted for "acc-1"
    And "acc-1" is not halted

  @AC-2 @regression
  Scenario: A page error while draining platform positions skips the account for the tick
    Given the portfolio ListPositions fake returns page 1 for "acc-1" and fails on page 2
    When reconcileTick runs
    Then the position-side check for "acc-1" is skipped for that tick
    And no reconciliation candidate is recorded from the partial set

  @AC-3 @regression
  Scenario: Reconcile rejects a repeated next_page_token
    Given the portfolio ListPositions fake ignores page_token and returns the same next_page_token every call
    When reconcileTick drains "acc-1"'s platform positions
    Then the drain stops on the repeated token and the position-side check for "acc-1" is skipped for that tick
