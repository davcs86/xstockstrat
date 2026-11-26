# Promoted from docs/roadmap/features/366-opportunity-live-only-rotation/acceptance.feature (C-16). Verbatim; do not hand-edit.
Feature: opportunity-live-only-rotation
  As a trader, I want every non-held signal symbol that a live strategy covers to eventually get that
  strategy's opportunity row, so that symbols outside the top 20 by signal conviction are not
  permanently excluded from the Decide queue.

  Background:
    Given opportunity.max_live_only_symbols_per_compute is 20
    And opportunity.live_only_cycle_max_days is 3
    And the user holds no positions
    And live strategies squeeze_breakout_trend and fundamentals_macd_blend cover every watchlisted symbol
    And 45 watchlisted symbols, including AAPL and NVDA, have an active signal and are bound only to dip_buyer_vol_stop

  @AC-1 @FR-1 @feature-366
  Scenario: One compute evaluates at most one chunk of live-only symbols
    When the opportunity queue is computed once
    Then exactly 20 of the 45 symbols have squeeze_breakout_trend rows
    And exactly 20 of the 45 symbols have fundamentals_macd_blend rows

  @AC-2 @FR-1 @FR-2 @feature-366
  Scenario: Successive computes cover the whole live-only pool
    When the opportunity queue is computed 3 times with no change to signals, watchlists or positions
    Then all 45 symbols have a squeeze_breakout_trend row
    And all 45 symbols have a fundamentals_macd_blend row
    And AAPL has a squeeze_breakout_trend row

  @AC-3 @FR-3 @feature-366
  Scenario: Rows from an earlier chunk survive the next compute
    Given the first compute produced a squeeze_breakout_trend row for AAPL with valid_until 2026-11-28T05:00Z
    When the opportunity queue is computed a second time and AAPL is not in the second chunk
    Then AAPL still has a squeeze_breakout_trend row
    And that row's valid_until is still 2026-11-28T05:00Z

  @AC-4 @FR-4 @feature-366
  Scenario: A symbol that leaves the pool loses its carried live-only rows
    Given AAPL has a carried squeeze_breakout_trend row from an earlier chunk
    When AAPL's only active signal expires
    And the opportunity queue is computed again
    Then AAPL has no squeeze_breakout_trend row
    And AAPL keeps its dip_buyer_vol_stop row

  @AC-5 @FR-5 @feature-366
  Scenario: The rotation position survives a restart
    Given the first compute produced squeeze_breakout_trend rows for the 20 symbols of the first chunk, which includes NVDA but not AAPL
    When the analysis service restarts
    And the opportunity queue is computed again
    Then 20 symbols that had no squeeze_breakout_trend row after the first compute now have one
    And NVDA's squeeze_breakout_trend row still has the valid_until stamped by the first compute

  @AC-6 @FR-6 @feature-366
  Scenario: A symbol joining the pool gets its rows within one full cycle
    Given the first compute has run
    When ZM gains an active signal and joins the live-only pool
    And the opportunity queue is computed 3 more times
    Then ZM has a squeeze_breakout_trend row

  @AC-7 @FR-7 @feature-366
  Scenario: Held and watchlist-bound rows are unaffected by the rotation
    Given the user holds AAPL
    When the opportunity queue is computed once
    Then AAPL has rows for dip_buyer_vol_stop, squeeze_breakout_trend and fundamentals_macd_blend
    And those rows are traced against each strategy's exit rule

  @AC-8 @FR-6 @feature-366
  Scenario: Removing pool members does not delay the remaining members past one full cycle
    Given the first compute has run
    When 10 symbols that already have squeeze_breakout_trend rows lose their active signals
    And the opportunity queue is computed 3 more times
    Then every one of the remaining 35 symbols has a squeeze_breakout_trend row
    And none of the 10 removed symbols has a squeeze_breakout_trend row

  @AC-9 @FR-7 @feature-366
  Scenario: The held-symbol and per-symbol strategy caps keep their current limits
    Given opportunity.max_live_held_symbols_per_compute is 20
    And opportunity.max_live_strategies_per_symbol is 5
    And the user holds 25 symbols that are not watchlist-bound and are covered by 7 live strategies each
    When the opportunity queue is computed once
    Then exactly 20 of the 25 held symbols have live-attributed rows
    And no held symbol has more than 5 live-attributed rows

  @AC-10 @FR-2 @feature-366
  Scenario: A full rotation finishes within the configured cycle bound
    Given the queue is recomputed once a day by the daily refresh
    And the live-only pool has 45 symbols
    When 3 calendar days pass from the first compute
    Then all 45 symbols have a squeeze_breakout_trend row
    And no single compute produced squeeze_breakout_trend rows for more than 20 symbols

  @AC-11 @FR-2a @feature-366
  Scenario: An oversized pool keeps the per-compute limit and reports the shortfall
    Given the queue is recomputed once a day by the daily refresh
    And the live-only pool has 350 symbols
    When the opportunity queue is computed once
    Then no more than 20 symbols get new squeeze_breakout_trend rows in that compute
    And a live-only rotation shortfall is recorded with pool size 350 and a projected cycle longer than 3 days

  @AC-12 @FR-8 @feature-366
  Scenario: A carried row older than one full cycle is removed
    Given AAPL has a carried squeeze_breakout_trend row computed at 2026-11-22T05:00Z
    And AAPL is still in the live-only pool
    When the opportunity queue is computed at 2026-11-26T05:00Z and AAPL is not in that compute's chunk
    Then AAPL has no squeeze_breakout_trend row
    And AAPL keeps its dip_buyer_vol_stop row
