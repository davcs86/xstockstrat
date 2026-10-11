# Promoted from docs/roadmap/features/196-proto-deprecated-field-removal-program/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-196` tag.
# Durable rule: the deprecated string Bar.timeframe is never returned to a caller, but the edge that
# feeds persistence keeps it.

Feature: xstockstrat-marketdata — deprecated Bar.timeframe string omitted from responses
  Bar responses carry timeframe_enum only; the source bar written by InsertBars still carries the
  canonical string because the ohlcv.timeframe column is read back by every bar query.

  @AC-8 @FR-2 @regression @feature-196
  Scenario: an edge that also feeds persistence is never an omission edge
    Given the Bar produced by barFromAlpaca flows into InsertBars which writes the ohlcv.timeframe column
    When a GetBars, BatchGetBars or StreamBars response is built
    Then the deprecated string timeframe is unset on every returned Bar and timeframe_enum is populated
    And the bar persisted by InsertBars still carries the canonical timeframe string
    And a 400-day GetBars / BatchGetBars daily-bar query still returns rows
