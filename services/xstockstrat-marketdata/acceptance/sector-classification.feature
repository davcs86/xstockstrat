# Promoted from docs/roadmap/features/217-sector-classification-strategy-params/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-217` tag.
# Durable business rules xstockstrat-marketdata guarantees for sector classification and the shared
# FMP gateway. Backed by: @AC-1/@AC-4 refund → internal/fmp/fmp_gateway_test.go; @AC-2/@AC-3/@AC-11/
# @AC-12 → internal/repository/classification_repo_test.go; @AC-4 read → internal/service/
# classification_service_test.go.

Feature: xstockstrat-marketdata — sector classification store and the single FMP throttle
  Sector classification is a Type-2 history served only from the local store, and every FMP call
  path shares one rate limiter and one UTC-day budget, so vendor limits hold and an FMP outage
  never breaks reads.

  @feature-217 @AC-1
  Scenario: FMP gateway never exceeds the configured rate limit under concurrency
    Given marketdata.fmp.rate_limit_rps is set to 5
    And 50 classification-refresh requests are issued to the centralized FMP gateway at once
    When the gateway dispatches the outbound FMP calls
    Then no more than 5 outbound FMP requests are made in any rolling 1-second window

  @feature-217 @AC-4
  Scenario: An FMP outage does not break classification reads
    Given the FMP API returns HTTP 503 for every request during a refresh cycle
    And symbol "XYZ" has an existing open classification row with sector "ENERGY"
    When a caller reads the current sector for "XYZ"
    Then the read returns "ENERGY" from the local store
    And the read does not error

  @feature-217 @AC-4
  Scenario: Failed FMP calls refund the shared daily budget
    Given the shared FMP daily budget has 0 calls used
    When every FMP call in a refresh cycle fails with HTTP 503
    Then the shared FMP daily budget still has 0 calls used
    And later fundamentals fetches are not throttled by the outage

  @feature-217 @AC-2
  Scenario: A sector change writes a new version and closes the prior one
    Given symbol "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_to NULL
    When the refresh job observes FMP now reports "XYZ" as "COMMUNICATION_SERVICES"
    Then the prior row's valid_to is set to the refresh timestamp
    And a new row is inserted with sector "COMMUNICATION_SERVICES" and valid_to NULL
    And exactly one open row exists for "XYZ"

  @feature-217 @AC-12
  Scenario: Concurrent first-observation of a symbol yields exactly one open row seeded at the epoch
    Given "NEWCO" has no classification row
    When two refresh workers observe FMP reports "NEWCO" as "HEALTH_CARE" at the same instant
    Then exactly one open classification row exists for "NEWCO"
    And its valid_from is 1900-01-01T00:00:00Z

  @feature-217 @AC-3 @FR-3
  Scenario: An unchanged sector performs no write
    Given symbol "XYZ" has one open classification row with sector "TECHNOLOGY"
    When the refresh job observes FMP still reports "XYZ" as "TECHNOLOGY"
    Then no row is inserted or updated for "XYZ"
    And the open row's valid_from is unchanged

  @feature-217 @AC-5 @FR-5
  Scenario: As-of lookup returns the sector valid at a historical timestamp
    Given "XYZ" was "TECHNOLOGY" from 2018-01-01 to 2018-09-30 and "COMMUNICATION_SERVICES" from 2018-10-01 onward
    When the as-of classification is requested for "XYZ" at 2018-06-15
    Then the returned sector is "TECHNOLOGY"

  @feature-217 @AC-11 @FR-10 @FR-2
  Scenario: The first post-go-live reclassification closes the epoch-seeded row without rewriting pre-go-live history
    Given "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_from 1900-01-01T00:00:00Z
    When the refresh job observes FMP now reports "XYZ" as "ENERGY" at 2026-10-01T00:00:00Z
    Then the epoch-seeded row's valid_to is set to 2026-10-01T00:00:00Z
    And a new open row is inserted with sector "ENERGY" and valid_from 2026-10-01T00:00:00Z
    And an as-of lookup for "XYZ" at 2015-06-15 returns "TECHNOLOGY"
    And an as-of lookup for "XYZ" at 2026-10-02 returns "ENERGY"
