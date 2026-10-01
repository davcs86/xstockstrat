Feature: fix-historical-fundamentals-price-join (bug fix)
  Regression guard for defect report 2026-09-27-fundamentals-backfill-not-rederived-defect.md:
  historical fundamentals price-join is never re-derived, so bars arriving after a fundamentals
  backfill leave price-derived metrics permanently missing.

  @AC-1 @regression
  Scenario: re-running a fundamentals backfill after bars exist re-derives the price-join metrics
    Given a symbol whose point-in-time fundamentals were backfilled while it had no stored daily bars
    And every one of its fundamentals_history periods has price, market_cap, pe_ratio, pb_ratio, and dividend_yield reported as missing
    And its daily OHLCV bars are subsequently stored
    When a fundamentals backfill is re-run for that symbol with overwrite=true
    Then each affected period has price, market_cap, pe_ratio, pb_ratio, and dividend_yield derived from the now-available bars and persisted
    And querying the symbol's historical fundamentals no longer reports those metrics as missing

  @AC-2 @regression
  Scenario: a genuinely-missing price bar still fails closed without a permanent unrecoverable gap
    Given a symbol with no stored daily bars covering a fundamentals period
    When a fundamentals backfill is run for that symbol
    Then the price-derived metrics for that period are left unset rather than fabricated
    And a later backfill run, after bars for that period are stored, re-derives and persists those metrics

  @AC-3 @regression
  Scenario: a plain re-backfill fills only the missing price-join columns and never touches populated ones
    Given a symbol with one fundamentals_history period whose price-join columns are all missing
    And another period on the same symbol whose price-join columns are already populated
    And daily OHLCV bars are now stored covering both periods' filing dates
    When a fundamentals backfill is re-run for that symbol without overwrite
    Then the period with missing columns has them derived from the now-available bars and persisted
    And the already-populated period's price-join columns are left unchanged
    And every period's as-reported fields and earliest filed_date are unchanged

  @AC-4 @regression
  Scenario: overwrite=true refreshes an already-populated price-join to the current derived value
    Given a fundamentals_history period whose price, market_cap, pe_ratio, and pb_ratio are already populated from an earlier price-join
    And the daily OHLCV bar at that period's stored filing date now resolves to a different adjusted close
    When a fundamentals backfill is re-run for that symbol with overwrite=true
    Then that period's price, market_cap, pe_ratio, and pb_ratio are recomputed from the current bar at the stored filing date and persisted
    And the period's currency, eps, roe, debt_to_equity, and earliest filed_date are unchanged
    And a subsequent overwrite=true re-run against the same bars persists no further write

  @AC-5 @regression
  Scenario: overwrite=true never nulls a pre-existing dividend_yield whose trailing-12-month window predates the current fetch lookback
    Given a fundamentals_history period with a non-null dividend_yield derived when its trailing-12-month window was covered
    And the current dividend fetch lookback no longer reaches back to that period's trailing-12-month window
    When a fundamentals backfill is re-run for that symbol with overwrite=true
    Then the period's dividend_yield retains its stored value
    And no price-join column for that period transitions from a value to null
