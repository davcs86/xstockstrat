# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-marketdata - namespace-relative config reads
  What xstockstrat-marketdata guarantees: provider-keyed settings are resolved with namespace-relative keys, with no alias.

  @AC-3 @FR-1 @feature-304
  Scenario: Marketdata builds provider keys relative to its namespace
    Given namespace "marketdata" stores "fmp.cache_ttl_hours" = 12 and "finnhub.cache_ttl_hours" = 6
    And the alias is off
    When marketdata resolves the cache TTL for provider "fmp" and for provider "finnhub"
    Then the TTL is 12 hours for provider "fmp" and 6 hours for provider "finnhub", not the code default
