Feature: fix-sandbox-result-contract (bug fix)
  Regression guard for clustered defect reports: the indicators sandbox reports its failure class,
  memory use, and missing-result outcome truthfully.

  # guards: docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md
  @AC-1 @regression
  Scenario: A formula exception carrying a guard message is classified as a runtime error
    Given an ExecuteFormula request with formula_source 'raise ValueError("is not allowed in sandbox")'
    When the sandbox runs the formula
    Then the result has success false
    And exit_reason is "runtime_error", not "import_blocked"

  # guards: docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md
  @AC-2 @regression
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

  # guards: docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md
  @AC-3 @regression
  Scenario: A formula that never assigns result fails with an explicit error
    Given an ExecuteFormula request with inline formula_source "x = 1" and empty input_data
    When the sandbox runs the formula
    Then the result has success false
    And the error message contains "result"

  # guards: docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md
  @AC-4 @regression
  Scenario: A formula that explicitly assigns an empty result still succeeds
    Given an ExecuteFormula request with inline formula_source "result = {}" and empty input_data
    When the sandbox runs the formula
    Then the result has success true
    And the output is {}
