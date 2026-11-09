# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-indicators - namespace-relative sandbox keys
  What xstockstrat-indicators guarantees: the sandbox-keys operator check expects the relative spelling.

  @AC-16 @FR-2 @feature-304
  Scenario: The sandbox-keys operator check expects the relative spelling
    Given namespace "indicators" stores "sandbox.timeout_ms" = 5000, "sandbox.memory_bytes" = 134217728 and "sandbox.allowed_imports" = "numpy,pandas,math,statistics" in the global scope
    And the migration-031 snapshot table config.config_values_premigration_031 exists
    When "python -m app.maintenance.sandbox_keys_check" runs against that database
    Then it exits 0 and reports PASS
    And a database that still stores "indicators.sandbox.timeout_ms" makes it exit 1
