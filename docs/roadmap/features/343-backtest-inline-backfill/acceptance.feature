Feature: backtest-inline-backfill
  As a trader, I want to backfill the data a backtest is missing directly from its insufficient-data message and then re-run it, so that I can get a result without leaving the Backtests card.

  @AC-1 @FR-1
  Scenario: The insufficient-data message offers a backfill action
    Given a backtest of "dip_buyer_vol_stop" on "LYFT" that returned insufficient data with 53 of 200 bars
    When the Backtests card is shown
    Then the message "has 53, needs 200 bars" is shown with a "Backfill missing data" action

  @AC-2 @FR-2
  Scenario: The backfill covers exactly the missing range
    Given the insufficient-data result reports a gap from 2023-03-17 to 2024-01-01 for "LYFT"
    When "Backfill missing data" is activated
    Then a daily-bars backfill is requested for "LYFT" from 2023-03-17 to 2024-01-01

  @AC-3 @FR-3
  Scenario: Progress is shown inline while the backfill runs
    Given a backfill for "LYFT" triggered from the Backtests card is running with 120 of 200 bars processed
    When the Backtests card is shown
    Then it shows "Backfilling… 120 / 200 bars"
    And the "Backfill missing data" action is disabled

  @AC-4 @FR-4
  Scenario: A completed backfill offers a re-run and does not run it
    Given the backfill for "LYFT" triggered from the Backtests card has completed
    When the Backtests card is shown
    Then it shows "Data ready" with a "Re-run backtest" action
    And no new backtest run has been requested

  @AC-5 @FR-4
  Scenario: Re-running after the backfill produces a result
    Given the Backtests card shows "Data ready" for "LYFT"
    When "Re-run backtest" is activated
    Then a backtest of "dip_buyer_vol_stop" on "LYFT" is requested
    And the insufficient-data message is no longer shown once it returns status OK

  @AC-6 @FR-5
  Scenario: A failed backfill reports its error and can be retried
    Given the backfill for "LYFT" triggered from the Backtests card failed with error "vendor rate limit exceeded"
    When the Backtests card is shown
    Then it shows "Backfill failed: vendor rate limit exceeded"
    And the "Backfill missing data" action is enabled

  @AC-9 @FR-5
  Scenario Outline: A partial or canceled backfill says so and can be retried
    Given the backfill for "LYFT" triggered from the Backtests card ended with status "<status>" and error "<error>"
    When the Backtests card is shown
    Then it shows "<message>"
    And the "Backfill missing data" action is enabled

    Examples:
      | status   | error                    | message                                    |
      | PARTIAL  | 1 of 3 chunks failed     | Backfill partial: 1 of 3 chunks failed     |
      | CANCELED |                          | Backfill canceled                          |

  @AC-7 @FR-6
  Scenario: A non-admin user can run the inline backfill
    Given a signed-in user without the admin scope
    And an insufficient-data result for "LYFT"
    When "Backfill missing data" is activated
    Then the backfill is accepted and its status is "QUEUED"

  @AC-8 @FR-7
  Scenario: Fallback — the section shows scores only when backfill cannot be opened to everyone
    Given the fallback design was chosen
    And "LYFT" has no backtest score for "dip_buyer_vol_stop"
    When the Analysis tab is shown
    Then the section shows "Not enough data" for "dip_buyer_vol_stop"
    And it offers no "Run backtest" or backfill action
