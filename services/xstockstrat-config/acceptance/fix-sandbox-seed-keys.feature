# Promoted from docs/roadmap/features/243-fix-sandbox-seed-keys/acceptance.feature (C-16). Do not hand-edit; provenance tags preserved.
Feature: fix-sandbox-seed-keys (config migration guarantees)

  @AC-1 @FR-1 @regression @feature-243
  Scenario: After the corrective migration no bare sandbox keys remain and the full-dotted rows exist
    Given config migrations up to the corrective migration have run
    When config.config_values is queried for namespace "indicators"
    Then no row has key "sandbox.timeout_ms", "sandbox.memory_bytes" or "sandbox.allowed_imports"
    And rows "indicators.sandbox.timeout_ms", "indicators.sandbox.memory_bytes" and "indicators.sandbox.allowed_imports" exist for environment "production"
    And the same three full-dotted rows exist for environment "staging"
    And in environments "production" and "staging" the "indicators.sandbox.timeout_ms" row has value 5000
    And in environments "production" and "staging" the "indicators.sandbox.memory_bytes" row has value 134217728
    And in environments "production" and "staging" the "indicators.sandbox.allowed_imports" row has value "numpy,pandas,math,statistics"
    And in both environments the "indicators.sandbox.timeout_ms", "indicators.sandbox.memory_bytes" and "indicators.sandbox.allowed_imports" rows have value_type "int", "int" and "string"

  @AC-3 @FR-3 @regression @feature-243
  Scenario: The memory_bytes row describes headroom, not an absolute cap
    Given config migrations up to the corrective migration have run
    When the "indicators.sandbox.memory_bytes" rows are read
    Then one row is returned for each of environments "production" and "staging"
    And each row's description names headroom above the measured VmData baseline
    And no row's description contains "memory cap"
    And no row's description contains "64MB"

  @AC-4 @FR-4 @regression @feature-243
  Scenario: The heal does not abort when a full-dotted row already exists in the same scope
    Given config migrations up to 030 have run
    And a global row "indicators.sandbox.timeout_ms" with value 4000 exists for environment "production" alongside the bare "sandbox.timeout_ms" row
    When the corrective migration runs
    Then the migration completes with no unique violation on config_values_scope_uniq
    And exactly one global "indicators.sandbox.timeout_ms" row exists for environment "production"
    And no "sandbox.timeout_ms" row exists for environment "production"

  @AC-5 @FR-4 @regression @feature-243
  Scenario: A pre-existing full-dotted row keeps its value and the bare row is removed
    Given config migrations up to 030 have run
    And a global row "indicators.sandbox.timeout_ms" with value 4000 exists for environment "production" alongside the bare "sandbox.timeout_ms" row
    When the corrective migration runs
    Then the global "indicators.sandbox.timeout_ms" row for environment "production" has value 4000
    And no "sandbox.timeout_ms" row exists for environment "production"
