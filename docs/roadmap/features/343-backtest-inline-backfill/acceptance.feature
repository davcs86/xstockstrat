Feature: backtest-inline-backfill
  As a trader, I want to backfill the data a backtest is missing directly from its insufficient-data message and then re-run it, so that I can get a result without leaving the Backtests card.

  @AC-1 @FR-1
  Scenario: The insufficient-data message offers a backfill action
    Given a backtest of "dip_buyer_vol_stop" on "LYFT" that returned insufficient data with 53 of 200 bars
    When the Backtests card is shown
    Then the message "has 53, needs 200 bars" is shown with a "Backfill missing data" action

  # Amended 2026-11-15 (operator, design gate, D-8): the range runs from the gap start through the
  # end of the backtest window, in gaps-only mode. It was "exactly the missing range".
  @AC-2 @FR-2
  Scenario: The backfill covers the missing range through the end of the backtest window
    Given the insufficient-data result reports a gap from 2023-03-17 to 2024-01-01 for "LYFT"
    And the backtest window ends on 2024-12-31
    When "Backfill missing data" is activated
    Then a daily-bars backfill is requested for "LYFT" from 2023-03-17 to 2024-12-31
    And the request asks for missing bars only, without overwrite

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

  # Examples rewritten 2026-11-15 (D-12): a PARTIAL job carries chunk counts, not an error string,
  # and can end PARTIAL with no failed chunk. Covered by the round-5 design approval (O-33).
  @AC-9 @FR-5
  Scenario Outline: A partial or canceled backfill says so and can be retried
    Given the backfill for "LYFT" triggered from the Backtests card ended with status "<status>" after <completed> of <total> chunks completed
    When the Backtests card is shown
    Then it shows "<message>"
    And the "Backfill missing data" action is enabled

    Examples:
      | status   | completed | total | message                                                       |
      | PARTIAL  | 2         | 3     | Backfill partial: 1 of 3 chunks failed                        |
      | PARTIAL  | 3         | 3     | Backfill partial: LYFT returned no data for part of the range |
      | CANCELED | 1         | 3     | Backfill canceled                                             |

  @AC-7 @FR-6
  Scenario: A non-admin user can run the inline backfill
    Given a signed-in user without the admin scope
    And an insufficient-data result for "LYFT"
    When "Backfill missing data" is activated
    Then the backfill is accepted and its status is "QUEUED"

  # STRUCK 2026-11-15: the FR-7 fallback is not taken (operator, design gate; design.md R-6).
  # The ID AC-8 stays reserved and is never reused (C-15).
  # @AC-8 @FR-7
  # Scenario: Fallback — the section shows scores only when backfill cannot be opened to everyone
  #   Given the fallback design was chosen
  #   And "LYFT" has no backtest score for "dip_buyer_vol_stop"
  #   When the Analysis tab is shown
  #   Then the section shows "Not enough data" for "dip_buyer_vol_stop"
  #   And it offers no "Run backtest" or backfill action

  @AC-10 @FR-6
  Scenario Outline: The insights strategy page backfill button works for every signed-in user
    Given a signed-in user <role> the admin scope
    And the insights strategy page shows an insufficient-data result with a gap for "AAPL"
    When "Backfill this range" is activated
    Then a daily-bars backfill is requested for "AAPL" over exactly that gap
    And the request fill mode is <fill mode>

    Examples:
      | role    | fill mode                 |
      | without | missing bars only         |
      | with    | the full range, as before |

  @AC-11 @FR-6
  Scenario: A second backfill for a symbol that already has one is refused and can be retried
    Given a self-serve backfill for "LYFT" is already queued or running
    When a signed-in user without the admin scope activates "Backfill missing data" for "LYFT"
    Then no second job is created
    And the card shows "A backfill for LYFT is already queued or running. Try again when it finishes."
    And the "Backfill missing data" action is enabled

  @AC-12 @FR-6
  Scenario: A backfill longer than the self-serve limit is refused with the span and the limit
    Given the self-serve range limit is 730 days
    And an insufficient-data result for "LYFT" whose backfill range spans 1825 days
    When a signed-in user without the admin scope activates "Backfill missing data"
    Then no job is created
    And the card shows "This backtest needs 1825 days of history, more than the self-serve limit of 730 days. Ask an admin to backfill LYFT."

  @AC-13 @FR-5
  Scenario: A gap the vendor cannot fill is reported instead of offering the backfill again
    Given the backfill for "LYFT" triggered from the Backtests card has completed
    When "Re-run backtest" returns insufficient data with the same gap from 2023-03-17 to 2024-01-01
    Then the card shows "No vendor data for 2023-03-17 to 2024-01-01"
    And it offers no "Backfill missing data" action for that gap

  @AC-14 @FR-3
  Scenario: Progress without a bar total shows no fraction
    Given a backfill for "LYFT" triggered from the Backtests card is queued with no bar total yet
    When the Backtests card is shown
    Then it shows "Backfilling…"
    And the "Backfill missing data" action is disabled

  @AC-15 @FR-6
  Scenario Outline: A non-admin request outside the self-serve envelope is denied with its reason
    Given a signed-in user without the admin scope
    When a backfill is requested that breaks the "<condition>" condition
    Then it is denied with "self-serve backfill denied: <token>"
    And no job is created

    Examples:
      | condition                         | token          |
      | exactly one symbol                | multi_symbol   |
      | bars only                         | data_kind      |
      | missing bars only                 | fill_mode      |
      | no overwrite                      | overwrite      |
      | explicit range with start < end   | range_unset    |
      | range within the self-serve limit | range_too_long |
      | no callback URL                   | callback_url   |
      | a real user id                    | no_user        |

  @AC-16 @FR-5
  Scenario: A failed backfill with no error text reports its chunk counts
    Given the backfill for "LYFT" triggered from the Backtests card failed with no error after 0 of 3 chunks completed
    When the Backtests card is shown
    Then it shows "Backfill failed: 3 of 3 chunks failed"
    And the "Backfill missing data" action is enabled
