Feature: fix-indicator-pane-warmup (bug fix)
  Regression guard for docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md.

  @AC-1 @FR-1 @regression
  Scenario: A 200-period average renders across the whole charted window
    Given "LYFT" has 400 ingested daily bars
    And the configured history depth is 1000 bars
    And the indicator chart window covers the latest 190 bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 series has a value on each of the 190 charted bars

  @AC-2 @FR-2 @regression
  Scenario: An indicator without enough history says so instead of drawing a dot
    Given "LYFT" has 150 ingested daily bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 pane shows "Not enough history" and draws no series

  @AC-3 @FR-1
  Scenario: History equal to the lookback yields a value on the last charted bar only
    Given "LYFT" has 200 ingested daily bars
    And the configured history depth is 1000 bars
    And the indicator chart window covers the latest 190 bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 series has a value on the last charted bar and a gap on the 189 earlier bars
    And the SMA200 pane does not show "Not enough history"

  @AC-4 @FR-2
  Scenario: Only the indicator lacking history reports it; the others still render
    Given "LYFT" has 150 ingested daily bars
    And the indicator chart window covers the latest 100 bars
    When the indicator set containing SMA with period 200 and SMA with period 20 is shown
    Then the SMA200 pane shows "Not enough history" and draws no series
    And the SMA20 series has a value on each of the 100 charted bars
