Feature: readiness-materializer-config-keys
  As a platform operator/admin, I want the analysis.readiness_materializer.* config keys registered
  and visible in config-ui, so that I can enable the readiness materializer without a code change or a
  raw admin-scoped SetConfig create.

  @AC-1 @FR-1 @FR-3
  Scenario: The seed migration registers all four materializer keys per environment
    Given a config database with no analysis.readiness_materializer.* rows
    When migration 027_analysis_readiness_materializer_keys.up.sql is applied
    Then config.config_values contains global (user_id NULL) rows for keys
      "analysis.readiness_materializer.enabled", "analysis.readiness_materializer.refresh_hour_utc",
      "analysis.readiness_materializer.valid_window_hours", and
      "analysis.readiness_materializer.max_concurrent_bars_fetches"
    And each key has exactly one row for environment "staging" and one for "production"
    And the "key" column holds the full dotted form (e.g. "analysis.readiness_materializer.enabled"), not a bare "readiness_materializer.enabled"

  @AC-2 @FR-1 @FR-2
  Scenario: Keys are seeded at their current code defaults with getter-matching value_type
    Given migration 027 has been applied
    When the seeded rows are inspected
    Then "analysis.readiness_materializer.enabled" has value_type "bool" and value_data "false"
    And "analysis.readiness_materializer.refresh_hour_utc" has value_type "int" and value_data "0"
    And "analysis.readiness_materializer.valid_window_hours" has value_type "int" and value_data "24"
    And "analysis.readiness_materializer.max_concurrent_bars_fetches" has value_type "int" and value_data "2"

  @AC-3 @FR-2
  Scenario: Applying the migration changes no runtime behavior on its own
    Given the analysis service reads analysis.readiness_materializer.enabled via get_bool default false
    When migration 027 is applied and analysis receives the config snapshot
    Then get_bool("analysis.readiness_materializer.enabled") resolves to false (the seeded value equals the code default)
    And the readiness materializer loop remains OFF until an operator sets enabled=true

  @AC-4 @FR-3
  Scenario: The migration is idempotent and reversible
    Given migration 027_up has already been applied once
    When 027_up is applied a second time
    Then no duplicate rows are created (ON CONFLICT DO NOTHING)
    And applying 027_down deletes exactly the four analysis.readiness_materializer.* global rows and no other analysis key

  @AC-5 @FR-4
  Scenario: An admin can enable the materializer from config-ui after registration
    Given migration 027 has registered analysis.readiness_materializer.enabled as a global row
    When an admin opens the config-ui analysis namespace and sets analysis.readiness_materializer.enabled to true
    Then the SetConfig update succeeds without needing create_key
    And a subsequent GetConfig for namespace analysis returns analysis.readiness_materializer.enabled = true

  @AC-6 @FR-5
  Scenario: Docs no longer claim the keys have no seed migration
    Given the analysis CLAUDE.md Config Keys table previously stated "No seed migration" for the analysis.readiness_materializer.* keys
    When feature 182 lands
    Then those four rows cite seed migration 027 instead of "No seed migration"
    And the config-governance per-feature registered-keys log records the four keys under feature 182
    And the ~5 other analysis.* / analysis.opportunity.* rows that still have no seed migration keep their "No seed migration" note unchanged

  @AC-7 @FR-6
  Scenario: An in-bounds tuning write is accepted
    Given migration 027 has registered the materializer keys and their SCALAR_BOUNDS_REGISTRY bounds
    When an admin sets analysis.readiness_materializer.refresh_hour_utc to 6 and max_concurrent_bars_fetches to 5
    Then both SetConfig writes succeed
    And a subsequent GetConfig returns refresh_hour_utc=6 and max_concurrent_bars_fetches=5

  @AC-8 @FR-6
  Scenario: An out-of-bounds tuning write is rejected at the write edge
    Given migration 027 has registered the materializer keys and their bounds (refresh_hour_utc [0,23], valid_window_hours [1,168], max_concurrent_bars_fetches [1,5])
    When an admin tries to set analysis.readiness_materializer.max_concurrent_bars_fetches to 10000
    Then SetConfig is rejected with INVALID_ARGUMENT and the stored value is unchanged
    And setting refresh_hour_utc to 99 is likewise rejected INVALID_ARGUMENT

  @AC-9 @FR-2
  Scenario: The bounds are write-path only and change no read path
    Given the materializer keys are registered with bounds and seeded at code defaults
    When the analysis service receives the config snapshot
    Then get_bool("analysis.readiness_materializer.enabled") still resolves to false
    And the readiness materializer loop remains OFF (bounds reject only out-of-range future writes; no read path is altered)
