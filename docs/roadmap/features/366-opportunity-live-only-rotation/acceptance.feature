Feature: opportunity-live-only-rotation
  As a trader, I want every non-held signal symbol that a live strategy covers to eventually get that
  strategy's opportunity row, so that symbols outside the top 20 by signal conviction are not
  permanently excluded from the Decide queue.

  Background:
    Given opportunity.max_live_only_symbols_per_compute is 20
    And the user holds no positions
    And live strategies squeeze_breakout_trend and fundamentals_macd_blend cover every watchlisted symbol
    And 45 watchlisted symbols, including AAPL, have an active signal and are bound only to dip_buyer_vol_stop

  @AC-1 @FR-1
  Scenario: One compute evaluates at most one chunk of live-only symbols
    When the opportunity queue is computed once
    Then exactly 20 of the 45 symbols have squeeze_breakout_trend rows
    And exactly 20 of the 45 symbols have fundamentals_macd_blend rows

  @AC-2 @FR-1 @FR-2
  Scenario: Successive computes cover the whole live-only pool
    When the opportunity queue is computed 3 times with no change to signals, watchlists or positions
    Then each of the 45 symbols was evaluated for squeeze_breakout_trend in at least one of the 3 computes
    And AAPL has a squeeze_breakout_trend row after the third compute

  @AC-3 @FR-3
  Scenario: Rows from an earlier chunk survive the next compute
    Given the first compute produced a squeeze_breakout_trend row for AAPL
    When the opportunity queue is computed a second time and AAPL is not in the second chunk
    Then AAPL still has a squeeze_breakout_trend row

  @AC-4 @FR-4
  Scenario: A symbol that leaves the pool loses its carried live-only rows
    Given AAPL has a carried squeeze_breakout_trend row from an earlier chunk
    When AAPL's only active signal expires
    And the opportunity queue is computed again
    Then AAPL has no squeeze_breakout_trend row
    And AAPL keeps its dip_buyer_vol_stop row

  @AC-5 @FR-5
  Scenario: The rotation position survives a restart
    Given the first compute evaluated chunk 1 of 3
    When the analysis service restarts
    And the opportunity queue is computed again
    Then the compute evaluates chunk 2, not chunk 1

  @AC-6 @FR-6
  Scenario: A symbol joining the pool is evaluated within one full cycle
    Given the first compute evaluated chunk 1 of 3
    When ZM gains an active signal and joins the live-only pool
    And the opportunity queue is computed 3 more times
    Then ZM was evaluated for squeeze_breakout_trend in one of those 3 computes

  @AC-7 @FR-7
  Scenario: Held and watchlist-bound rows are unaffected by the rotation
    Given the user holds AAPL
    When the opportunity queue is computed once
    Then AAPL has rows for dip_buyer_vol_stop, squeeze_breakout_trend and fundamentals_macd_blend
    And those rows are traced against each strategy's exit rule
