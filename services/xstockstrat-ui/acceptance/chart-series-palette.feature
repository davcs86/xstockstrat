# Promoted from docs/roadmap/features/342-chart-series-palette/acceptance.feature (Constitution C-16).
# Provenance: @feature-342.

Feature: chart-series-palette
  As a trader, I want each indicator series drawn in its own clearly distinguishable color, so that I can read a multi-indicator chart and match every legend entry to its line.

  @AC-1 @FR-1 @feature-342
  Scenario: Both themes define twelve series colors
    Given the staging and production theme bundles
    When the categorical series palette tokens are read
    Then each theme defines exactly 12 series color tokens
    And the staging values of "--chart-1" through "--chart-5" are unchanged

  @AC-2 @FR-2 @feature-342
  Scenario: Five series across four indicators get five different colors
    Given the indicator set "dip_buyer_vol_stop" with series "rsi.value", "px.value", "sma200.value", "vts.stop_line" and "vts.value"
    When the indicator chart for "LYFT" is shown
    Then the 5 series are drawn in 5 different colors
    And "vts.stop_line" and "vts.value" are drawn in different colors
    And the colors are palette entries 1 through 5 in the order the series are listed

  @AC-3 @FR-3 @feature-342
  Scenario: Each legend swatch matches its line
    Given the indicator chart for "LYFT" with the "dip_buyer_vol_stop" set
    When the Indicators legend is shown
    Then the swatch beside "sma200 value" has the same color as the SMA200 line
    And the swatch beside "vts stop_line" has the same color as the "vts.stop_line" line

  @AC-4 @FR-4 @feature-342
  Scenario: Every series color meets the contrast floor in both themes
    Given the 12 series colors of the staging theme and its "--card" and "--background" colors
    When the contrast ratio of each series color against "--card" and against "--background" is computed
    Then every ratio is at least 3.0
    And the same holds for the production theme's 12 series colors against its "--card" and "--background"

  @AC-5 @FR-4 @feature-342
  Scenario: Series colors stay distinguishable for normal and red-green color-blind vision
    Given the 12 series colors in palette order, where entry 12 and entry 1 are adjacent
    When every pair is compared by CIEDE2000 distance under deuteranopia simulation, under protanopia simulation, and under normal vision
    Then under each simulation every adjacent pair differs by at least 10
    And under each simulation every other pair differs by at least 5
    And under normal vision every pair differs by at least 10

  @AC-6 @FR-5 @feature-342
  Scenario: A thirteenth series reuses the first color
    Given an indicator set of 13 single-series components "sma1" through "sma13", each with the series "value"
    When the indicator chart for "LYFT" is shown
    Then "sma13.value" is drawn in the same color as "sma1.value"
    And "sma1.value" through "sma12.value" are drawn in 12 different colors
