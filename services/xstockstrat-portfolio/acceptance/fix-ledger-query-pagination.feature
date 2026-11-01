# Promoted from feature 257 (fix-ledger-query-pagination) at launch, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-ledger-query-pagination (bug fix)
  Regression guard: GetPnL pages through ledger QueryEvents without double-counting fills and never returns a partial sum.

  @AC-3 @FR-5 @regression @feature-257
  Scenario: GetPnL folds each fill exactly once across ledger pages
    Given the ledger holds 501 "order.filled" events for user "u-1" from trading, alternating buy 1 "AAPL" @ 100.00 and sell 1 "AAPL" @ 101.00, ending with a buy
    When GetPnL runs for user "u-1"
    Then realized_pnl is 250.00

  @AC-6 @FR-5 @regression @feature-257
  Scenario: GetPnL keeps the largest cumulative partial fill of an order that spans ledger pages
    Given the ledger holds one "order.filled" event for user "u-1" from trading buying 600 "AAPL" @ 100.00
    And it holds 501 "order.partially_filled" events for user "u-1" from trading for sell order "o-s" on "AAPL" @ 101.00, with sell-signed cumulative filled_qty -1, -2, ... -501 (largest magnitude -501)
    And order "o-s" has no "order.filled" event
    When GetPnL runs for user "u-1"
    Then realized_pnl is 501.00

  @AC-4 @FR-6 @regression @feature-257
  Scenario: GetPnL fails rather than returning a partial sum when a page cannot be read
    Given the ledger returns a first page of 500 "order.filled" events for user "u-1" with a non-empty next_page_token
    And the next QueryEvents call fails with DEADLINE_EXCEEDED
    When GetPnL runs for user "u-1"
    Then GetPnL returns an error with code UNAVAILABLE or DEADLINE_EXCEEDED
    And no realized_pnl value is returned
