Feature: signal-performance-attribution
  Per-source trading performance metrics derived from real fills, so a platform
  operator can tune signal source weights with data instead of intuition.
  Single source of acceptance truth (Constitution C-15). Every FR-N in
  product-spec.md is covered by >= 1 tagged scenario below.

  Background:
    Given the operator is authenticated as the owner of the attributed trades
    And attribution is computed over closed positions only (batch, not real-time)

  @AC-1 @FR-1
  Scenario: GetAttribution returns per-source metrics for a date range
    Given 20 closed paper trades attributed to source_id="form4" between 2026-08-01 and 2026-08-31
    And 13 of those trades closed with realized P&L greater than 0 net of fees
    When the operator calls GetAttribution(start=2026-08-01, end=2026-08-31)
    Then the response contains a SourceAttribution row for "form4"
    And that row reports trade_count=20, win_count=13, win_rate=65%, and a total realized P&L
    And the win rate and P&L values reconcile against the underlying ledger fill records

  @AC-2 @FR-6
  Scenario: Insights UI renders the attribution table and sorts by a column
    Given a GetAttribution response with rows for "form4" and "news"
    When the operator opens the signal-performance attribution panel in the /insights UI
    Then a table is shown with columns source name, trades, win rate, avg return %, and total P&L
    And clicking the "win rate" column header re-orders the rows by win rate descending

  @AC-3 @FR-2
  Scenario: Orders with no signal-attribution inputs are counted as manual and excluded from per-source metrics
    Given 20 closed orders carrying signal-attribution inputs resolving to source_id="form4"
    And 5 closed orders submitted with no signal-attribution inputs
    When GetAttribution runs for the enclosing date range
    Then the 5 signal-less fills are categorized as "manual"
    And they are excluded from the "form4" per-source metrics
    And the "form4" row still reports trade_count=20

  @AC-4 @FR-3
  Scenario: A trade is attributed to the highest-weighted signal source
    Given an order whose analysis score had input weights source_id="form4"=0.7 and source_id="news"=0.3
    When attribution is computed for that order's closed position
    Then the entire trade is attributed to "form4"
    And no fractional attribution is assigned to "news"

  @AC-5 @FR-3
  Scenario: An exact tie in input weights splits attribution equally (the only V1 fractional case)
    Given an order whose analysis score had input weights source_id="form4"=0.5 and source_id="news"=0.5
    When attribution is computed for that order's closed position
    Then the trade is attributed 0.5 to "form4" and 0.5 to "news"
    And this equal split applies only on an exact tie; otherwise V1 is winner-takes-all (AC-4)

  @AC-6 @FR-4
  Scenario: Win is defined as realized P&L greater than 0 after fees
    Given a closed position with gross realized P&L of $12 and $15 of accumulated fees
    When win/loss is computed for that trade
    Then the net realized P&L is -$3 and the trade is counted as a loss
    And a second closed position with gross realized P&L $50 and $10 fees nets $40 and is counted as a win

  @AC-10 @FR-4
  Scenario: A per-fill fee flows through the fee-capture plumbing into the net win test
    Given a fill carrying a $1.20 fee on the "order.filled" event payload
    And that fill fully closes a position whose gross realized P&L is $1.00
    When the portfolio realized-P&L fold accumulates the fee and seals the position
    Then the "portfolio.position.closed" event carries fees_total=$1.20 and an unchanged gross realized_pnl=$1.00
    And analysis persists fees_total=$1.20 on the pnl_positions row
    And GetAttribution's win test uses net = $1.00 - $1.20 = -$0.20 and counts the trade as a loss

  @AC-11 @FR-4
  Scenario: A position with no captured fee data is netted at gross (no silent fee)
    Given a closed position whose fills carried no fee value (fees_total defaults to 0)
    When win/loss is computed for that trade
    Then the net realized P&L equals the gross realized P&L
    And the win/loss outcome is identical to the gross-only result

  @AC-7 @FR-5
  Scenario: Metrics are filterable by source ID within a date range
    Given closed trades attributed to source_id="form4" and source_id="news" across August 2026
    When the operator calls GetAttribution(start=2026-08-01, end=2026-08-31, source_id="form4")
    Then only trades attributed to "form4" within that range are returned
    And no "news" row appears in the response

  @AC-8 @FR-7
  Scenario: The table exports to clipboard as CSV
    Given the attribution table is displayed with rows for "form4" and "news"
    When the operator clicks the "copy to clipboard" button
    Then a valid CSV is placed on the clipboard
    And its header row is "source name,trades,win rate,avg return %,total P&L"
    And it contains one data line per displayed source

  @AC-9 @FR-1 @FR-5
  Scenario: A newly registered signal source appears automatically with no code change
    Given a signal source source_id="insider8k" registered after this feature shipped
    And 3 closed trades attributed to "insider8k" within 2026-08-01 to 2026-08-31
    When GetAttribution(start=2026-08-01, end=2026-08-31) runs with no code change
    Then a SourceAttribution row for "insider8k" appears with trade_count=3
