# Promoted from docs/roadmap/features/256-fix-offline-book-consistency/acceptance.feature (C-16).
# Scenarios are verbatim. Provenance tag: @feature-256.
Feature: fix-offline-book-consistency (trading)
  Offline ConfirmOrder must reject non-finite or negative fills and must not report success when the positions emit fails.

  @AC-4 @FR-5 @regression @feature-256
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

  @AC-5 @FR-6 @regression @feature-256
  Scenario: ConfirmOrder does not report success when the positions emit fails
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    And recomputeAndEmitOfflinePositions fails for the account of "ord-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty 10 and filled_avg_price 150.0
    Then either the emit is retried until "account.positions.synced" is published for the account
    Or the call returns an error, and a repeat ConfirmOrder with the same values succeeds and emits "account.positions.synced"

  @AC-7 @FR-7 @regression @feature-256
  Scenario Outline: Valid fills keep the existing offline status derivation
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty <qty> and filled_avg_price 150.0
    Then order "ord-1" has status <status>
    And "account.positions.synced" is emitted for the account of "ord-1"

    Examples:
      | qty | status           |
      | 4   | PARTIALLY_FILLED |
      | 10  | FILLED           |

  @AC-10 @FR-5 @FR-7 @regression @feature-256
  Scenario: An un-confirm with filled_qty 0 stays valid without a fill price
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1" confirmed with filled_qty 10 and filled_avg_price 150.0
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty 0 and filled_avg_price 0
    Then the call succeeds and order "ord-1" has status NEW
    And "account.positions.synced" is emitted for the account of "ord-1"
