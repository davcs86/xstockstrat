# Promoted from docs/roadmap/features/182-readiness-materializer-config-keys/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance on every scenario's `@feature-182` tag.
# Durable business rules xstockstrat-config guarantees for the analysis.readiness_materializer.* keys
# registered by migration 027 + their SCALAR_BOUNDS_REGISTRY write-bounds.

Feature: readiness-materializer-config-keys (config-service guarantees)
  What xstockstrat-config guarantees for the seeded, operator-editable analysis.readiness_materializer.*
  keys: they are settable via SetConfig without create_key once registered, and the three numeric tuning
  keys reject out-of-range writes at the write edge while touching no read path.

  @AC-5 @FR-4 @feature-182
  Scenario: A registered materializer key is settable via SetConfig without create_key
    Given migration 027 has registered analysis.readiness_materializer.enabled as a global row
    When an admin SetConfig sets analysis.readiness_materializer.enabled to true without create_key
    Then the write succeeds (the seeded row satisfies the existence gate)
    And a subsequent GetConfig for namespace analysis returns analysis.readiness_materializer.enabled = true

  @AC-7 @FR-6 @feature-182
  Scenario: An in-bounds tuning write is accepted
    Given the materializer keys carry SCALAR_BOUNDS_REGISTRY bounds (refresh_hour_utc [0,23], valid_window_hours [1,168], max_concurrent_bars_fetches [1,5])
    When an admin sets analysis.readiness_materializer.refresh_hour_utc to 6 and max_concurrent_bars_fetches to 5
    Then both SetConfig writes succeed and the values are stored

  @AC-8 @FR-6 @feature-182
  Scenario: An out-of-bounds tuning write is rejected at the write edge
    Given max_concurrent_bars_fetches is bounded [1,5] and refresh_hour_utc is bounded [0,23]
    When an admin tries to set analysis.readiness_materializer.max_concurrent_bars_fetches to 10000
    Then SetConfig is rejected with INVALID_ARGUMENT and no value is written
    And setting analysis.readiness_materializer.refresh_hour_utc to 99 is likewise rejected INVALID_ARGUMENT

  @AC-9 @FR-2 @feature-182
  Scenario: The bounds are write-path only and change no read path
    Given the materializer keys are registered with bounds and seeded at code defaults
    When an admin sets the unbounded analysis.readiness_materializer.enabled key
    Then the write is accepted (no numeric bound applies to a bool)
    And WatchConfig/GetConfig read behavior is unchanged by the bounds (the materializer stays OFF at the seeded enabled=false)
