Feature: fix-offline-book-consistency (bug fix)
  Regression guard for docs/reports/2026-10-21-offline-book-consistency-defect.md:
  offline-account books (feature 240) must not drift or misreport P&L on a failed write, a failed
  state read, or a non-finite confirm.

  @AC-1 @FR-1 @regression
  Scenario: A failed offline realized-P&L write is retried, not acked
    Given user "u-1" has offline account "acct-off-1" with stored realized_pnl 0.00
    And UpsertOfflineRealized fails once, then succeeds
    When portfolio consumes an offline "account.positions.synced" event for "acct-off-1" carrying realized_pnl 500.00
    Then the event cursor does not advance past that event after the first failure
    And the event is delivered again
    And the stored realized_pnl for "acct-off-1" is 500.00

  @AC-2 @FR-2 @regression
  Scenario: A failed offline-realized delete on deregistration is retried
    Given user "u-1" has offline account "acct-off-1" with a realized row
    And DeleteOfflineRealized fails once, then succeeds
    When portfolio consumes "account.deregistered" for "acct-off-1"
    Then the "account.deregistered" event is delivered again after the failed delete
    And no realized row remains for "acct-off-1"
    And "acct-off-1" no longer appears in ListPortfolios for "u-1"

  @AC-3 @FR-4 @regression
  Scenario Outline: Offline P&L is never reported as complete when offline state cannot be read
    Given user "u-1" has offline account "acct-off-1" with realized_pnl 500.00 and an AAPL position with unrealized_pnl 100.00
    And GetOfflineStates returns an error
    When <read> is called for "u-1"
    Then the call does not return total_pnl 100.00 as a complete figure
    And it either fails with UNAVAILABLE or marks the "acct-off-1" valuation as degraded

    Examples:
      | read           |
      | ListPortfolios |
      | GetPortfolio   |
      | ListPositions  |
      | GetPosition    |

  @AC-4 @FR-5 @regression
  Scenario Outline: ConfirmOrder rejects a non-finite or negative fill
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty <qty> and filled_avg_price <price>
    Then the call fails with INVALID_ARGUMENT
    And order "ord-1" is unchanged and no "account.positions.synced" is emitted

    Examples:
      | qty  | price |
      | NaN  | 150.0 |
      | +Inf | 150.0 |
      | 10   | NaN   |
      | 10   | -5.0  |
      | 10   | +Inf  |

  @AC-5 @FR-6 @regression
  Scenario: ConfirmOrder does not report success when the positions emit fails
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    And recomputeAndEmitOfflinePositions fails for the account of "ord-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty 10 and filled_avg_price 150.0
    Then either the emit is retried until "account.positions.synced" is published for the account
    Or the call returns an error, and a repeat ConfirmOrder with the same values succeeds and emits "account.positions.synced"

  @AC-6 @FR-3 @regression
  Scenario: A persistently failing offline sync event is parked and does not block the stream
    Given user "u-1" has offline account "acct-off-1"
    And UpsertOfflineRealized always fails for event "evt-1"
    And event "evt-2" for offline account "acct-off-2" follows "evt-1" on the stream
    When portfolio consumes "evt-1" and "evt-2"
    Then "evt-1" is parked with an error log naming "evt-1" once the retry bound is reached
    And the event cursor advances past "evt-1"
    And "evt-2" is applied

  @AC-7 @FR-7 @regression
  Scenario Outline: Valid fills keep the existing offline status derivation
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty <qty> and filled_avg_price 150.0
    Then order "ord-1" has status <status>
    And "account.positions.synced" is emitted for the account of "ord-1"

    Examples:
      | qty | status           |
      | 4   | PARTIALLY_FILLED |
      | 10  | FILLED           |
