# Promoted from docs/roadmap/features/215-block-fundamentals-strategy-on-etf/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-215` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-7 internal/service/marketdata_service_test.go (feature215 cases) + fmp/finnhub client
# tests; @AC-14 internal/service/etf_flags_test.go.

Feature: xstockstrat-marketdata — block fundamentals-gated strategies on symbols without fundamentals (ETFs)
  A strategy that requires fundamentals is refused, denied entry, or skipped with an explicit,
  auditable reason on a symbol with no usable fundamentals (an ETF such as SCHD), never a silent
  no-trade that reads like a genuine no-signal.

  @AC-7 @FR-7 @feature-215
  Scenario: Marketdata reports fundamentals absence distinctly from outage and disable
    Given snapshot_source is "edgar" and marketdata.fmp.enabled and marketdata.finnhub.enabled are false
    When GetFundamentalsMulti is called for ["SCHD", "BABA"]
    Then only "BABA" is returned and no error is raised
    And GetFundamentals for "SCHD" returns NotFound
    And a vendor "no fundamentals for symbol" response also returns NotFound
    When marketdata.edgar.enabled is false
    Then both RPCs return FailedPrecondition

  @AC-14 @FR-11 @feature-215
  Scenario: The ETF label never spends the guard's FMP headroom
    Given the shared FMP day budget is at or above 80% of marketdata.fmp.daily_request_cap
    When GetEtfFlags is called for an uncached "SCHD"
    Then is_etf is unset, no FMP call is made, and the background fill does not fetch "SCHD"
    And a cached flag is served for 30 days without re-fetch
