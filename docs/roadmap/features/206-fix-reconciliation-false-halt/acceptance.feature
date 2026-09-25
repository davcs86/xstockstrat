Feature: fix-reconciliation-false-halt (bug fix)
  Regression guard for the reconciliation false-halt recorded in
  docs/reports/2026-09-25-reconciliation-false-halt-defect.md.

  @AC-1 @regression
  Scenario: A broker position explained by the platform's own filled orders does not halt
    Given a paper account whose broker reports a position of 10 AMAT
    And the platform's own filled orders for that account and symbol net to 10 AMAT
    And the portfolio projection (ListPositions) transiently reports 0 for AMAT
    When the reconciliation poller runs past its grace window
    Then no reconciliation.mismatch_found event is emitted for AMAT
    And the account is not halted

  @AC-2 @regression
  Scenario: A genuinely foreign broker position still halts
    Given a paper account whose broker reports a position of 10 AMAT
    And the platform's own filled orders for that account and symbol net to 0 AMAT
    And the portfolio projection reports 0 for AMAT
    When the reconciliation poller runs past its grace window
    Then a reconciliation.mismatch_found event of class quantity_discrepancy is emitted for AMAT
    And the account is halted

  @AC-3 @regression
  Scenario: A net-filled-qty lookup error never causes a false halt
    Given a paper account whose broker reports a position of 10 AMAT
    And the portfolio projection reports 0 for AMAT
    And the trading.orders net-filled-qty lookup fails
    When the reconciliation poller runs
    Then no reconciliation.mismatch_found event is emitted for AMAT
    And the account is not halted

  @AC-4 @regression
  Scenario: An empty broker position snapshot does not delete order-fill-derived positions
    Given a portfolio position for an account seeded from an order fill
    When an account.positions.synced broker snapshot with an empty positions list is consumed
    Then the existing order-fill-derived position is not deleted

  @AC-5 @regression
  Scenario: An offline full-close recompute still purges positions
    Given a portfolio position for an offline account
    When an account.positions.synced with an empty positions list and a realized_pnl value is consumed
    Then the offline account's positions are purged
