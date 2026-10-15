Feature: fix-sandbox-memory-cap (bug fix)
  Regression guard for docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md:
  The sandbox memory cap is not enforced on the DigitalOcean runtime.

  @AC-1 @FR-1 @regression
  Scenario: An over-headroom formula is killed even when the kernel ignores RLIMIT_DATA
    Given the formula sandbox with indicators.sandbox.memory_bytes = 134217728 (128 MiB headroom)
    And a runtime where setrlimit(RLIMIT_DATA) is accepted but not enforced
    When a formula allocates and writes a 400 MiB numpy array
    Then it fails with exit_reason "memory_exceeded"

  @AC-2 @FR-2 @regression
  Scenario: A non-effective memory cap is detected at startup
    Given the indicators service starts on a runtime where RLIMIT_DATA is not enforced
    When the startup self-check runs
    Then the service reports that the memory cap is not kernel-enforced
