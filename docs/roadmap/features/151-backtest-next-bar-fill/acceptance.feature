Feature: backtest-next-bar-fill
  As a strategy analyst, I want backtest fills at the next bar's open, so that backtested
  performance realistically reflects what live execution could have achieved.

  @AC-1 @FR-1
  Scenario: An entry signal fills at the next bar's open
    Given a strategy whose entry condition becomes true on bar i in next-bar-open mode
    When the engine fills the entry
    Then the entry price is bar (i+1)'s open adjusted for slippage
    And it is not bar i's close

  @AC-2 @FR-1
  Scenario: An exit (including the vts stop) fills at the next bar's open
    Given an open position whose exit or vts-stop condition becomes true on bar i in next-bar-open mode
    When the engine fills the exit
    Then the exit price is bar (i+1)'s open adjusted for slippage
    And it is not bar i's close

  @AC-3 @FR-2
  Scenario: A signal on the final bar introduces no look-ahead
    Given an entry signal that becomes true on the last bar of the window in next-bar-open mode
    When the engine processes that bar
    Then no position is opened (there is no next bar to fill against)
    And no price from outside the window is referenced

  @AC-4 @FR-3
  Scenario: Legacy same-bar-close fill remains the default and is unchanged
    Given a backtest request that does not specify a fill model
    When the run executes
    Then fills occur at the same bar's close as before
    And the run's total_return byte-for-byte matches the pre-feature result for the same inputs

  @AC-5 @FR-3
  Scenario: The fill model used is recorded on the run
    Given a backtest executed in next-bar-open mode
    When the run is persisted and returned to the caller
    Then the recorded/returned fill model is "next_bar_open"
    And a legacy run records/returns "same_bar_close"

  @AC-6 @FR-4
  Scenario: Per-bar diagnostics stay aligned with the fill bar
    Given a next-bar-open run that opens a position from a signal on bar i
    When the per-bar diagnostics are finalized
    Then the ENTER action is recorded on the bar where the fill occurs
    And the daily_equity series remains 1:1 with the diagnostics series

  @AC-7 @FR-1
  Scenario: An n-2 entry signal fills, preserving cross-mode trade-count symmetry
    Given an entry signal that becomes true on bar (n-2) in next-bar-open mode
    When the engine processes the window
    Then a position opens at bar (n-1)'s open and is force-closed at bar (n-1)'s close
    And the total trade count equals the same-bar-close run for the identical signal

  @AC-8 @FR-1 @FR-4
  Scenario: Cooldown spacing is measured fill-bar to fill-bar in next-bar mode
    Given a strategy with a 3-day re-entry cooldown in next-bar-open mode
    And an exit that fills on bar f
    When a later entry signal would fill on the bar exactly 3 trading days after bar f
    Then the re-entry is allowed at that fill bar
    And an entry that would fill one bar earlier is gated

  @AC-9 @FR-3
  Scenario: The effective fill model is resolved once and round-trips
    Given the config default analysis.backtest.default_fill_model is "next_bar_open"
    And a backtest request that omits fill_model
    When the run executes and is persisted and returned
    Then the run executes next-bar-open
    And the persisted and echoed fill model is the effective "next_bar_open", not an unspecified request value

  @AC-10 @FR-3
  Scenario: An unspecified request with no config override is byte-for-byte legacy
    Given a backtest request that omits fill_model
    And no config default for analysis.backtest.default_fill_model
    When the run executes
    Then fills occur at the same bar's close
    And trades, daily_equity, and per-bar diagnostics are byte-for-byte identical to the pre-feature result

  @AC-11 @FR-5
  Scenario: A next-bar fill row shows the prior bar's signal beside the current bar's conviction
    Given a next-bar-open run where a signal on bar i fills on bar (i+1)
    When the per-bar diagnostics are rendered
    Then diags[i+1].action reflects bar i's signal
    And diags[i+1].conviction reflects bar (i+1)'s own decision
    And the derived grade is unaffected because grade math never reads conviction
