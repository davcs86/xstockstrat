Feature: fix-indicators-sandbox-matrix (bug fix)
  Regression guard for docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md:
  The indicators sandbox matrix test fails on some hosts because the child runs at its 128 MiB memory cap.

  @AC-1 @FR-1 @regression
  Scenario: The 800x800 matmul fits within half the default headroom
    Given the formula sandbox with indicators.sandbox.memory_bytes = 67108864 (64 MiB headroom)
    And a formula computing a = default_rng(0).standard_normal((800, 800)) and b = a @ a.T
    When the formula is executed
    Then it succeeds with trace 641260.869 and rank 50

  @AC-2 @FR-2 @regression
  Scenario: An allocation beyond the headroom fails closed
    Given the formula sandbox with indicators.sandbox.memory_bytes = 16777216 (16 MiB headroom)
    When a formula allocates a 32 MiB numpy array
    Then it fails with exit_reason "memory_exceeded"

  @AC-3 @FR-1 @regression
  Scenario: The formula budget does not depend on the interpreter's import footprint
    Given the formula sandbox with allowed imports numpy, pandas, math, statistics
    And indicators.sandbox.memory_bytes = 67108864 (64 MiB, below the ~75 MiB import baseline)
    When a formula allocates a 32 MiB numpy array of ones
    Then it succeeds

  @AC-4 @FR-2 @regression
  Scenario: An OpenBLAS allocation abort is classified as out-of-memory
    Given a sandbox child that exits with code 1
    And its stderr contains "OpenBLAS error: Memory allocation still failed after 10 retries, giving up."
    When the result is classified
    Then exit_reason is "memory_exceeded"

  @AC-5 @FR-3 @regression
  Scenario: A failed baseline probe never runs the formula
    Given the sandbox child cannot parse VmData from /proc/self/status
    When any formula is executed with memory_bytes > 0
    Then it does not succeed and exit_reason is "runtime_error"
