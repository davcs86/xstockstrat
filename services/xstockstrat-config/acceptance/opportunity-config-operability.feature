# Promoted from docs/roadmap/features/184-opportunity-config-operability/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance on every scenario's `@feature-184` tag.
# Durable business rules xstockstrat-config guarantees for the analysis.opportunity.* keys seeded by
# migration 028 + their SCALAR_BOUNDS_REGISTRY write-bounds. (AC-6 UI visibility rides the generic
# namespace editor, already guaranteed by feature 161; AC-7 is a one-time doc-state landing check — both
# deliberately not promoted here.)

Feature: opportunity-config-operability (config-service guarantees)
  What xstockstrat-config guarantees for the seeded, operator-editable analysis.opportunity.* keys:
  they are registered per environment at their code defaults (a no-op seed), settable via SetConfig
  without create_key once registered, and the bounded numeric keys reject out-of-range writes at the
  write edge while accepting legitimate boundary values and touching no read path.

  @AC-1 @FR-1 @FR-3 @feature-184
  Scenario: The seed migration registers the opportunity keys per environment
    Given a config database with no seeded analysis.opportunity.* rows
    When the opportunity-keys seed migration is applied
    Then config.config_values holds global (user_id NULL) rows for the registered analysis.opportunity.* keys
    And each key has one row for environment "staging" and one for "production"
    And every "key" column holds the full dotted form (e.g. "analysis.opportunity.refresh_hour_utc")

  @AC-2 @FR-1 @feature-184
  Scenario: Keys are seeded at their current code defaults with getter-matching value_type
    Given the migration has been applied
    When the seeded rows are inspected
    Then "analysis.opportunity.refresh_hour_utc" has value_type "int" and value_data "0"
    And "analysis.opportunity.max_concurrent_bars_fetches" has value_type "int" and value_data "2"
    And "analysis.opportunity.signal_rank_weight" has value_type "float" and value_data "0.3"

  @AC-3 @FR-1 @feature-184
  Scenario: Applying the migration changes no runtime behavior on its own
    Given the analysis opportunity loop reads these keys with the same code defaults
    When the migration is applied and analysis receives the config snapshot
    Then every reader resolves to the same value it used before (seeded value == code default)
    And the opportunities compute/refresh behaves identically

  @AC-4 @FR-2 @feature-184
  Scenario: An out-of-bounds tuning write is rejected at the write edge
    Given max_concurrent_bars_fetches is bounded [1,5] and refresh_hour_utc is bounded [0,23]
    When an admin tries to set analysis.opportunity.max_concurrent_bars_fetches to 10000
    Then SetConfig is rejected with INVALID_ARGUMENT and no value is written
    And setting analysis.opportunity.refresh_hour_utc to 99 is likewise rejected INVALID_ARGUMENT
    And setting analysis.opportunity.signal_rank_weight to 1.5 is rejected (bounded [0,1])

  @AC-5 @FR-2 @feature-184
  Scenario: An in-bounds tuning write is accepted without create_key
    Given the keys are registered (seeded) and bounded
    When an admin sets analysis.opportunity.max_universe_size to 50 within its bound
    Then the SetConfig write succeeds without needing create_key
    And a subsequent GetConfig returns analysis.opportunity.max_universe_size = 50

  @AC-8 @FR-2 @feature-184
  Scenario: A bounded key whose lower edge is a legitimate value accepts that value
    Given refresh_hour_utc is bounded [0,23] and signal_rank_weight is bounded [0,1]
    When an admin sets analysis.opportunity.refresh_hour_utc to 0
    Then the SetConfig write succeeds (0 = midnight is a documented value, not rejected)
    And setting analysis.opportunity.signal_rank_weight to 0 is likewise accepted within its bound
