# Promoted from docs/roadmap/features/240-offline-account-full-pnl/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-240` tag.
# Durable business rules xstockstrat-ui already guarantees - a rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-ui - offline account full P&L surfaces in /trader
  The trader account card, Book offline card, positions list and position detail page show Day P&L,
  Total P&L, fees, since-snapshot and lifetime realized, and stale or missing price indicators for
  offline accounts, without faking Cash or Buying Power.

  @AC-14 @FR-6 @feature-240
  Scenario: The trader account card shows full P&L for an offline account
    Given "acc-1" has day_pnl 300.00, total_pnl 1300.00, total_pnl_pct 0.1238, since-snapshot realized 600.00 with fees_since_snapshot 3.00, lifetime realized 900.00 with fees_lifetime 4.50
    When the trader opens /trader with "acc-1" selected
    Then the PortfolioPanel shows "Day P&L" 300.00, "Total P&L" 1300.00 (12.38%), "Realized (since snapshot)" 600.00 with net 597.00, "Realized (lifetime)" 900.00 with net 895.50, "Fees (since snapshot)" 3.00, and "Fees (lifetime)" 4.50
    And the panel does not show "Cash" or "Buying Power"

  @AC-15 @FR-6 @feature-240
  Scenario: The Book page offline card shows the P&L summary
    Given "acc-1" has day_pnl 300.00 and total_pnl 1300.00
    When the trader opens /trader/portfolio
    Then the offline card for "acc-1" shows "Day P&L" 300.00 and "Total P&L" 1300.00 alongside Equity and the position count

  @AC-16 @FR-6 @feature-240
  Scenario: The positions list shows day P&L and a stale-mark indicator
    Given "acc-1" holds AAPL with day_pnl 300.00 and mark_source MARK_SOURCE_QUOTE
    And "acc-1" holds XYZ with mark_source MARK_SOURCE_LAST_CLOSE and mark_as_of "2026-10-16"
    When the trader opens /trader/positions
    Then the AAPL row shows Today's P/L 300.00
    And the XYZ row shows a stale-price indicator labelled "Last close 2026-10-16"

  @AC-30 @FR-6 @feature-240
  Scenario: The combined PortfolioPanel sums each account's own figures
    Given offline "acc-1" has day_pnl 300.00, total_pnl 1300.00, since-snapshot realized 600.00, and lifetime realized 900.00
    And Alpaca account "alp-1" has day_pnl 120.00 and total_pnl 500.00
    When the trader opens /trader with the combined view
    Then the PortfolioPanel shows "Day P&L" 420.00 and "Total P&L" 1800.00
    And it shows "Realized (since snapshot)" 600.00 and "Realized (lifetime)" 900.00, both labelled "Offline accounts only"

  @AC-31 @FR-6 @feature-240
  Scenario: The position detail page shows day P&L, signed short %, and mark provenance
    Given the read happens on Saturday "2026-10-17"
    And "acc-1" holds TSLA qty -10 @ avg 200.00 with no fills on session 2026-10-16 or since
    And the TSLA daily closes are 185.00 for session "2026-10-15" and 180.00 for session "2026-10-16"
    And there is no live TSLA quote
    When the trader opens /trader/positions/TSLA
    Then the page shows "Day P&L" 50.00 and unrealized 200.00 (+10.00%)
    And the page shows a stale-price indicator labelled "Last close 2026-10-16"

  @AC-32 @FR-6 @FR-5 @feature-240
  Scenario: The positions list shows a "No price" indicator for an unpriced position
    Given "acc-1" holds ZZZZ qty 5 with mark_source MARK_SOURCE_NONE
    When the trader opens /trader/positions
    Then the ZZZZ row shows qty 5 and an indicator labelled "No price"
    And the ZZZZ row shows no market value, unrealized P&L, or Today's P/L figure
