Feature: fix-sandbox-seed-keys (bug fix)
  Regression guard for docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md:
  indicators sandbox config seeds use bare keys and never apply.

  @AC-1 @regression
  Scenario: After the corrective migration no bare sandbox keys remain and the full-dotted rows exist
    Given config migrations up to the corrective migration have run
    When config.config_values is queried for namespace "indicators"
    Then no row has key "sandbox.timeout_ms", "sandbox.memory_bytes" or "sandbox.allowed_imports"
    And rows "indicators.sandbox.timeout_ms", "indicators.sandbox.memory_bytes" and "indicators.sandbox.allowed_imports" exist for environment "production"
    And the same three full-dotted rows exist for environment "staging"
    And the production "indicators.sandbox.timeout_ms" row has value 3000

  @AC-2 @regression
  Scenario Outline: The indicators watcher resolves the stored full-dotted sandbox row, not the code default
    Given the "production" config row "<key>" has value <stored>
    When xstockstrat-indicators receives its WatchConfig snapshot for namespace "indicators"
    Then the watcher property <property> returns <stored>

    Examples:
      | key                               | stored    | property             |
      | indicators.sandbox.timeout_ms     | 3000      | sandbox_timeout_ms   |
      | indicators.sandbox.memory_bytes   | 100663296 | sandbox_memory_bytes |

  @AC-3 @regression
  Scenario: The memory_bytes row describes headroom, not an absolute cap
    Given config migrations up to the corrective migration have run
    When the "indicators.sandbox.memory_bytes" rows are read
    Then each row's description names headroom above the measured VmData baseline
    And no row's description contains "memory cap"
