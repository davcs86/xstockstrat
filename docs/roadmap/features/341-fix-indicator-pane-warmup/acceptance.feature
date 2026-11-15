Feature: fix-indicator-pane-warmup (bug fix)
  Regression guard for docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md.

  @AC-1 @regression
  Scenario: A 200-period average renders across the whole charted window
    Given "LYFT" has 400 ingested daily bars
    And the indicator chart window covers the latest 190 bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 series has a value on each of the 190 charted bars

  @AC-2 @regression
  Scenario: An indicator without enough history says so instead of drawing a dot
    Given "LYFT" has 150 ingested daily bars
    When the indicator set containing SMA with period 200 is shown
    Then the SMA200 pane shows "Not enough history" and draws no series
