# Promoted from docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-364` tag.
# Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-gapsonly-backfill-is (ui)
  How the Backtests card presents a GAPS_ONLY backfill that finished with an unfillable interior hole.

  @AC-5 @FR-2 @feature-364
  Scenario: The Backtests card reports an unfillable interior hole as vendor data missing, not as a retryable partial
    Given the backfill for "LYFT" triggered from the Backtests card ended PARTIAL with every chunk completed
    And its only per-symbol result is "LYFT" with outcome "incomplete"
    When the Backtests card is shown
    Then it shows "Backfill finished: vendor has no bars for some sessions of LYFT"
    And it offers "Re-run backtest"
    And when "Re-run backtest" returns insufficient data with the same gap, the card shows "No vendor data for" that gap and no "Backfill missing data" action
