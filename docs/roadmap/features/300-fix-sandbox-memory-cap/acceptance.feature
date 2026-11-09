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
  Scenario: A non-enforcing runtime is reported at startup and the service keeps serving
    Given the indicators service starts on a runtime where a 256 MiB allocation succeeds under a 64 MiB RLIMIT_DATA
    When the startup self-check runs
    Then an ERROR log record "sandbox memory cap not kernel-enforced" is emitted
    And the memory-cap-enforced gauge reads 0
    And the service still starts and serves requests

  @AC-3 @FR-2 @regression
  Scenario: An enforcing runtime produces no non-effective-cap report
    Given the indicators service starts on a runtime where a 256 MiB allocation fails under a 64 MiB RLIMIT_DATA
    When the startup self-check runs
    Then no "sandbox memory cap not kernel-enforced" record is emitted
    And the memory-cap-enforced gauge reads 1
