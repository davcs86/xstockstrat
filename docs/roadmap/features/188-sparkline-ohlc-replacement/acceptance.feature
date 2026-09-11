Feature: sparkline-ohlc-replacement
  As a trader reviewing the opportunity queue, I want to see yesterday's OHLC price data next to
  the date instead of a sparkline chart, so that I can assess the symbol's recent price range at
  a glance without navigating to a separate chart.

  @AC-1 @FR-1
  Scenario: Opportunities List shows previous day OHLC instead of sparkline
    Given the Opportunities List page is loaded with symbol "AAPL" having 20 daily bars
    And the most recent completed bar is dated "2026-09-10" with open 228.50, high 231.20, low 227.80, close 230.10
    When the opportunity card for "AAPL" renders
    Then the card displays "Sep 10" and "O $228.50  H $231.20  L $227.80  C $230.10"
    And no sparkline bar chart is rendered in the card

  @AC-2 @FR-2
  Scenario: Symbol detail page header shows previous day OHLC instead of sparkline
    Given the symbol detail page for "AAPL" is loaded
    And the most recent completed daily bar is dated "2026-09-10" with open 228.50, high 231.20, low 227.80, close 230.10
    When the page header renders
    Then the header displays "Sep 10" and "O $228.50  H $231.20  L $227.80  C $230.10"
    And no sparkline bar chart is rendered in the header

  @AC-3 @FR-3
  Scenario: OHLC data sourced from existing getBars daily bar response
    Given the useSparklines hook fetches 20 daily bars via getBars for symbol "TSLA"
    When the bars response includes Bar.open, Bar.high, Bar.low, Bar.close, and Bar.time
    Then the hook exposes the most recent bar's full OHLC and date to the consuming component
    And no additional RPC call is made beyond the existing getBars

  @AC-4 @FR-4
  Scenario: OHLC block absent when bar data unavailable
    Given the Opportunities List page is loaded with symbol "XYZ" that has no daily bars
    When the opportunity card for "XYZ" renders
    Then no OHLC text block is displayed for "XYZ"
    And no sparkline bar chart is rendered for "XYZ"

  @AC-5 @FR-5
  Scenario: Shared Sparkline component deleted after removing its only two consumers
    Given the shared Sparkline component at src/components/shared/Sparkline.tsx has exactly 2 import sites
    And FormulaRunResult.tsx defines its own local Sparkline function using recharts LineChart
    When the sparkline-ohlc-replacement feature removes both import sites (OpportunityRow and symbol detail header)
    Then the shared Sparkline.tsx file is deleted from src/components/shared/
    And FormulaRunResult.tsx continues to function with its local Sparkline unchanged
