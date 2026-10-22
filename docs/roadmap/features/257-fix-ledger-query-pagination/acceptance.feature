Feature: fix-ledger-query-pagination (bug fix)
  Regression guard for docs/reports/2026-10-21-ledger-query-pagination-defect.md:
  QueryEvents ignores pageToken (D-13), GetPnL loops into an inflated P&L (D-46), and StreamEvents
  replay is one unbounded query on the single-connection pool (D-27).

  # "Exactly once" covers every matching event committed before the walk passes its sequence; a lower sequence
  # committing after the walk passed it is not delivered by that walk (operator sign-off 2026-10-22, change (a)).
  @AC-1 @FR-1 @FR-2 @regression
  Scenario: Following next_page_token returns each event exactly once
    Given the ledger holds 3 events of type "t" appended in order "e1", "e2", "e3"
    When QueryEvents is called with event_type "t" and page_size 2
    Then it returns "e1", "e2" and a non-empty next_page_token
    When QueryEvents is called again with event_type "t", page_size 2 and that next_page_token
    Then it returns only "e3" and an empty next_page_token

  @AC-2 @FR-3 @regression
  Scenario: An oversized page_size is capped at 1000
    Given the ledger holds 20000 events of type "t"
    When QueryEvents is called with event_type "t" and page_size 1000000
    Then it returns exactly 1000 events and a non-empty next_page_token

  @AC-3 @FR-5 @regression
  Scenario: GetPnL folds each fill exactly once across ledger pages
    Given the ledger holds 501 "order.filled" events for user "u-1" from trading, alternating buy 1 "AAPL" @ 100.00 and sell 1 "AAPL" @ 101.00, ending with a buy
    When GetPnL runs for user "u-1"
    Then realized_pnl is 250.00

  @AC-6 @FR-5 @regression
  Scenario: GetPnL keeps the last partial fill of an order that spans ledger pages
    Given the ledger holds one "order.filled" event for user "u-1" from trading buying 600 "AAPL" @ 100.00
    And it holds 501 "order.partially_filled" events for user "u-1" from trading for sell order "o-s" on "AAPL" @ 101.00, with cumulative filled_qty 1, 2, ... 501 in append order
    And order "o-s" has no "order.filled" event
    When GetPnL runs for user "u-1"
    Then realized_pnl is 501.00

  @AC-4 @FR-6 @regression
  Scenario: GetPnL fails rather than returning a partial sum when a page cannot be read
    Given the ledger returns a first page of 500 "order.filled" events for user "u-1" with a non-empty next_page_token
    And the next QueryEvents call fails with DEADLINE_EXCEEDED
    When GetPnL runs for user "u-1"
    Then GetPnL returns an error with code UNAVAILABLE or DEADLINE_EXCEEDED
    And no realized_pnl value is returned

  @AC-7 @FR-4 @regression
  Scenario: Callers that omit page_token still get the oldest first page
    Given the ledger holds 150 events of type "t" appended in order "e1" to "e150"
    When QueryEvents is called with event_type "t", no page_size and no page_token
    Then it returns "e1" to "e100" in ascending sequence order and a non-empty next_page_token
    When QueryEvents is called with event_type "t", page_size 500 and no page_token
    Then it returns "e1" to "e150" in ascending sequence order and an empty next_page_token

  # Evidence: unit FIFO interleave test (CI) + one recorded real-TimescaleDB run (context.md); not a CI job.
  # The 2-second bound is the pass threshold. On the buggy code the append waits for the whole replay.
  @AC-5 @FR-7 @regression
  Scenario: StreamEvents replay does not starve AppendEvent
    Given the ledger holds 200000 events and its query pool has 1 connection
    And a StreamEvents call is replaying from sequence 0
    When AppendEvent is called while the replay is still in progress
    Then AppendEvent commits within 2 seconds
    And the replay still delivers, in ascending sequence order and exactly once, every event committed before the replay passed its sequence
