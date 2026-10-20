# Promoted from docs/roadmap/features/227-fix-opportunities-read-hangs/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-227` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-3 internal/service/marketdata_service_test.go TestBatchGetLatestPrice_AC3_LogsMultiFetchErrorAndFallsBack.

Feature: xstockstrat-marketdata — BatchGetLatestPrice never drops an error silently
  Every vendor error BatchGetLatestPrice falls back from or drops is logged with the symbol count
  and the path taken.

  @AC-3 @regression @feature-227
  Scenario: marketdata logs the vendor error it falls back from
    Given the Alpaca multi-symbol latest-trades call fails with an error
    When marketdata serves "BatchGetLatestPrice" for "AAPL"
    Then the error is logged with the symbol count and the fallback path taken
