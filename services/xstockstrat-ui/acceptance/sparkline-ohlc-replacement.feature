# Promoted from docs/roadmap/features/188-sparkline-ohlc-replacement/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-188`
# tag. Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.
# AC-1/3/4 are withheld pending retirement of the feature-095 sparkline scenarios (see 188 context.md).

Feature: sparkline-ohlc-replacement
  As a trader reviewing the opportunity queue, I want to see yesterday's OHLC price data next to
  the date instead of a sparkline chart, so that I can assess the symbol's recent price range at
  a glance without navigating to a separate chart.

  @AC-2 @FR-2 @feature-188
  Scenario: Symbol detail page header shows previous day OHLC instead of sparkline
    Given the symbol detail page for "AAPL" is loaded
    And the most recent completed daily bar is dated "2026-09-10" with open 228.50, high 231.20, low 227.80, close 230.10
    When the page header renders
    Then the header displays "Sep 10" and "O $228.50  H $231.20  L $227.80  C $230.10"
    And no sparkline bar chart is rendered in the header

  @AC-5 @FR-5 @feature-188
  Scenario: Shared Sparkline component deleted after removing its only two consumers
    Given the shared Sparkline component at src/components/shared/Sparkline.tsx has exactly 2 import sites
    And FormulaRunResult.tsx defines its own local Sparkline function using recharts LineChart
    When the sparkline-ohlc-replacement feature removes both import sites (OpportunityRow and symbol detail header)
    Then the shared Sparkline.tsx file is deleted from src/components/shared/
    And FormulaRunResult.tsx continues to function with its local Sparkline unchanged

  @AC-6 @FR-6 @feature-188
  Scenario: Mobile signalGroup card shows previous day OHLC underneath symbol name
    Given the Opportunities List page is loaded on a mobile viewport with symbol "AAPL"
    And the most recent completed bar is dated "2026-09-10" with open 228.50, high 231.20, low 227.80, close 230.10
    When the mobile signalGroup card for "AAPL" renders
    Then the card header displays "AAPL" as the symbol name
    And directly underneath the symbol name the card displays "O $228.50  H $231.20  L $227.80  C $230.10"
    And when bar data is unavailable the OHLC block is absent from the card header
