Feature: fix-indicators-sandbox-matrix (bug fix)
  Regression guard for docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md:
  The indicators sandbox matrix test fails on some hosts because the child runs at its 128 MiB memory cap.

  @AC-1 @regression
  Scenario: A modest numpy matmul succeeds in the sandbox regardless of the host's BLAS kernel
    Given the formula sandbox at its default memory cap
    And a formula computing a = standard_normal((800, 800)) and b = a @ a.T
    When the formula is executed on any supported x86-64 host
    Then it succeeds with trace 641260.869 and rank 50
    And the child's peak data segment leaves measurable headroom below the cap

  @AC-2 @regression
  Scenario: A formula that genuinely exceeds the cap still fails closed
    Given the formula sandbox at its default memory cap
    When a formula allocates an array larger than the cap
    Then it fails with exit_reason "memory_exceeded"
