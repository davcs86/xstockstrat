Feature: fix-after-hours-positions-priced (bug fix)
  Regression guard for docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md:
  after-hours positions priced at about half value from a one-sided quote.

  @AC-1 @regression
  Scenario Outline: A one-sided quote never halves a position's price
    Given an offline account holds 10 "LYFT" with no broker valuation (current_price 0)
    And the latest "LYFT" quote has ask <ask> and bid <bid>
    When the caller reads ListPositions
    Then "LYFT" current_price is never <halved>
    And "LYFT" is either priced from a usable price or returned unenriched with current_price 0

    Examples:
      | ask   | bid   | halved |
      | 16.98 | 0     | 8.49   |
      | 0     | 16.98 | 8.49   |

  @AC-2 @regression
  Scenario: The persisted equity snapshot excludes one-sided quotes from equity
    Given the caller holds 10 "LYFT" whose latest quote has ask 16.98 and bid 0
    When the portfolio snapshot is computed
    Then equity never includes a "LYFT" value of 84.90

  @AC-3 @regression
  Scenario: The risk valuation never halves a position from a one-sided quote
    Given the caller holds 10 "LYFT" whose latest quote has ask 16.98 and bid 0
    When the risk/concentration valuation runs
    Then the "LYFT" position value is never 84.90

  @AC-4 @regression
  Scenario: The fundamentals live-price overlay ignores a one-sided quote
    Given the latest "LYFT" quote has ask 16.98 and bid 0
    When marketdata builds the EDGAR fundamentals snapshot for "LYFT"
    Then the snapshot price is never 8.49
