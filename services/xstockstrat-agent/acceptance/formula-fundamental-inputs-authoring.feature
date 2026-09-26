# Promoted from docs/roadmap/features/205-formula-fundamental-inputs-authoring/acceptance.feature at
# integration (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-205` tag. Durable business rule: the test_formula MCP tool dry-runs a fundamentals-only
# formula against supplied fundamentals values in the sandbox, requiring no OHLCV history.

Feature: xstockstrat-agent — test_formula for fundamentals-scoring formulas
  The test_formula MCP tool dry-runs a fundamentals-only formula against supplied fundamentals
  values in the sandbox, requiring no OHLCV history.

  @AC-5 @FR-4 @feature-205
  Scenario: Test a fundamentals-scoring formula with supplied values
    Given formula "pe_value_score" declares fundamental_inputs [PE_RATIO, PB_RATIO]
    When an author calls test_formula supplying input_data {pe_ratio: 12.5, pb_ratio: 1.8} (snake_case data-keys, the sandbox `data` vocabulary)
    Then the response returns the formula's output score computed from those values
    And no OHLCV closes are required for the run
