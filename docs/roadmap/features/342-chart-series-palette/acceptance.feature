Feature: chart-series-palette
  As a trader, I want each indicator series drawn in its own clearly distinguishable color, so that I can read a multi-indicator chart and match every legend entry to its line.

  @AC-1 @FR-1
  Scenario: Both themes define twelve series colors
    Given the staging and production theme bundles
    When the categorical series palette tokens are read
    Then each theme defines exactly 12 series color tokens
    And the staging values of "--chart-1" through "--chart-5" are unchanged

  @AC-2 @FR-2
  Scenario: Five series across four indicators get five different colors
    Given the indicator set "dip_buyer_vol_stop" with series "rsi.value", "px.value", "sma200.value", "vts.stop_line" and "vts.value"
    When the indicator chart for "LYFT" is shown
    Then the 5 series are drawn in 5 different colors

  @AC-3 @FR-3
  Scenario: Each legend swatch matches its line
    Given the indicator chart for "LYFT" with the "dip_buyer_vol_stop" set
    When the Indicators legend is shown
    Then the swatch beside "sma200 value" has the same color as the SMA200 line

  @AC-4 @FR-4
  Scenario: Every series color meets the contrast floor in both themes
    Given the 12 series colors and the chart surface color of the staging theme
    When the contrast ratio of each color against the surface is computed
    Then every ratio is at least 3.0
    And the same holds against the production theme's chart surface

  @AC-5 @FR-4
  Scenario: Adjacent series colors stay distinguishable for red-green color blindness
    Given the 12 series colors in palette order
    When each adjacent pair is compared under deuteranopia and protanopia simulation
    Then every adjacent pair differs by a CIEDE2000 distance of at least 10

  @AC-6 @FR-5
  Scenario: A thirteenth series reuses the first color
    Given an indicator set that produces 13 series
    When the indicator chart is shown
    Then series 13 is drawn in the same color as series 1
