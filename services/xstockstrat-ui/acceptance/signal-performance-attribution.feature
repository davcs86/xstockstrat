# Durable business-rule suite for xstockstrat-ui (Constitution C-16). Promoted from feature 029's
# acceptance.feature at launch; @feature-029 marks provenance. These are the guarantees a future
# feature must not regress (recon reads this suite; the design-adversary enforces it).
# The /insights segment renders the signal-performance attribution table over the GetAttribution response.

Feature: signal-performance-attribution
  The /insights segment renders per-source attribution metrics so an operator can
  compare signal sources and export the table.

  Background:
    Given the operator is authenticated as the owner of the attributed trades
    And attribution is computed over closed positions only (batch, not real-time)

  @AC-2 @FR-6 @feature-029
  Scenario: Insights UI renders the attribution table and sorts by a column
    Given a GetAttribution response with rows for "form4" and "news"
    When the operator opens the signal-performance attribution panel in the /insights UI
    Then a table is shown with columns source name, trades, win rate, avg return %, and total P&L
    And clicking the "win rate" column header re-orders the rows by win rate descending

  @AC-8 @FR-7 @feature-029
  Scenario: The table exports to clipboard as CSV
    Given the attribution table is displayed with rows for "form4" and "news"
    When the operator clicks the "copy to clipboard" button
    Then a valid CSV is placed on the clipboard
    And its header row is "source name,trades,win rate,avg return %,total P&L"
    And it contains one data line per displayed source
