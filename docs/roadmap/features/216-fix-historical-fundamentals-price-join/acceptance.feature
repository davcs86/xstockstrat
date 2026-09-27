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
