# Promoted from docs/roadmap/features/206-fix-reconciliation-false-halt/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-206` tag.
# Durable business rules xstockstrat-trading already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover the position-side
# broker-state reconciliation check being DB-grounded against trading.orders.

Feature: xstockstrat-trading — position-side reconciliation never false-halts on the platform's own fills
  Regression guard for the reconciliation false-halt recorded in
  docs/reports/2026-09-25-reconciliation-false-halt-defect.md (pruned 2026-10-05; git show 2ce8de0a:docs/reports/<file>).

  @AC-1 @regression @feature-206
  Scenario: A broker position explained by the platform's own filled orders does not halt
    Given a paper account whose broker reports a position of 10 AMAT
    And the platform's own filled orders for that account and symbol net to 10 AMAT
    And the portfolio projection (ListPositions) transiently reports 0 for AMAT
    When the reconciliation poller runs past its grace window
    Then no reconciliation.mismatch_found event is emitted for AMAT
    And the account is not halted

  @AC-2 @regression @feature-206
  Scenario: A genuinely foreign broker position still halts
    Given a paper account whose broker reports a position of 10 AMAT
    And the platform's own filled orders for that account and symbol net to 0 AMAT
    And the portfolio projection reports 0 for AMAT
    When the reconciliation poller runs past its grace window
    Then a reconciliation.mismatch_found event of class quantity_discrepancy is emitted for AMAT
    And the account is halted

  @AC-3 @regression @feature-206
  Scenario: A net-filled-qty lookup error never causes a false halt
    Given a paper account whose broker reports a position of 10 AMAT
    And the portfolio projection reports 0 for AMAT
    And the trading.orders net-filled-qty lookup fails
    When the reconciliation poller runs
    Then no reconciliation.mismatch_found event is emitted for AMAT
    And the account is not halted
