# Promoted from docs/roadmap/features/310-fix-sandbox-result-contract/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-310` tag.
# Durable business rules xstockstrat-indicators already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-indicators — the sandbox reports its failure class, memory use, and missing-result outcome truthfully
  Regression guard for clustered defect reports: docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md,
  docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md and
  docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md.

  @AC-1 @regression @feature-310
  Scenario: A formula exception carrying a guard message is classified as a runtime error
    Given an ExecuteFormula request with formula_source 'raise ValueError("is not allowed in sandbox")'
    When the sandbox runs the formula
    Then the result has success false
    And exit_reason is "runtime_error", not "import_blocked"

  @AC-2 @regression @feature-310
  Scenario: memory_used_bytes is a real per-run peak, not a fabricated or inherited figure
    Given the runtime renders a VmHWM line in /proc/self/status
    And run A is an ExecuteFormula request with formula_source "result = {}"
    And run B is an ExecuteFormula request with formula_source:
      """
      import numpy
      a = numpy.ones(10_000_000)
      result = {"s": float(a[0])}
      """
    When the sandbox runs A and then B
    Then A's memory_used_bytes is greater than 0
    And B's memory_used_bytes exceeds A's by at least 41943040

  @AC-3 @regression @feature-310
  Scenario: A formula that never assigns result fails with an explicit error
    Given an ExecuteFormula request with inline formula_source "x = 1" and empty input_data
    When the sandbox runs the formula
    Then the result has success false
    And the error message contains "result"

  @AC-4 @regression @feature-310
  Scenario: A formula that explicitly assigns an empty result still succeeds
    Given an ExecuteFormula request with inline formula_source "result = {}" and empty input_data
    When the sandbox runs the formula
    Then the result has success true
    And the output is {}
