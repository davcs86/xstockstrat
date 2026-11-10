Feature: fix-sandbox-memory-cap (bug fix)
  Regression guard for docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md`):
  The sandbox memory cap is not enforced on the DigitalOcean runtime.
  AC IDs are append-only. AC-10 was reserved for a sizing WARN that was cut at design and is never reused.

  @AC-1 @FR-1 @regression
  Scenario: An over-headroom formula is killed even when the kernel ignores RLIMIT_DATA
    Given the formula sandbox with indicators.sandbox.memory_bytes = 134217728 (128 MiB headroom)
    And a runtime where setrlimit(RLIMIT_DATA) is accepted but not enforced
    When a formula allocates, writes and holds a 400 MiB numpy array until it is stopped
    Then it fails with exit_reason "memory_exceeded"
    And the termination came from the parent watchdog, not from a MemoryError in the formula

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
    And the memory-watchdog-observable gauge reads 1

  @AC-4 @FR-1 @regression
  Scenario: Legitimate formulas are not killed while the watchdog is active
    Given the watchdog is active and the kernel cap is lifted so only the watchdog enforces the headroom
    When the 800x800 matmul runs with indicators.sandbox.memory_bytes = 67108864 (64 MiB headroom)
    And a 32 MiB array is allocated under that same 64 MiB headroom
    Then both succeed, with trace 641260.869 and rank 50 for the matmul
    And the recorded peak VmData growth and peak resident memory stay below the R1 and R2 thresholds

  @AC-5 @FR-1 @regression
  Scenario Outline: A SIGKILLed child is attributed by evidence
    Given a child exits with signal 9 and the watchdog did not kill it
    And the cgroup oom_kill counter changed by <delta> during the run
    When the result is classified
    Then exit_reason is "<reason>"
    And the error text is "<error>"

    Examples:
      | delta | reason          | error                                          |
      | 1     | memory_exceeded | formula exited with code -9 before producing output |
      | 0     | runtime_error   | formula exited with code -9 before producing output |

  @AC-6 @FR-1 @regression
  Scenario: A parent that cannot observe the child says so once and the formula still runs
    Given the sampler raises PermissionError, or the handoff line is malformed
    When two formulas run in the same process
    Then exactly one ERROR "sandbox memory watchdog cannot observe child" is emitted
    And the memory-watchdog-observable gauge reads 0
    And both formulas return their normal results
    And a child that exits before writing the handoff (a failed baseline probe) emits no such record

  @AC-7 @FR-1 @regression
  Scenario: Process-group sampling counts growth only and ignores zombies
    Given a leader and forked members observed on different ticks
    When a copy-on-write member has not grown, a member reuses a pid with a new start time,
      the leader or a member is a zombie, or RssAnon is missing from a running member
    Then the member contributes only its growth since first sight
    And the reused pid is a new member
    And zombies contribute 0 and emit no record
    And a missing RssAnon skips only the resident rule for that run, without a record

  @AC-8 @FR-1 @regression
  Scenario: A fork-bomb stays a typed error, the service recovers and nothing is mis-reported as unobservable
    Given the watchdog is active
    When a formula forks until the process limit
    Then the result is not a success
    And a following legitimate formula succeeds
    And no "sandbox memory watchdog cannot observe child" record is emitted

  @AC-9 @FR-3 @regression
  Scenario: The homelab render oracle asserts the indicators memory limit
    Given the rendered homelab compose configuration
    When mem_limit and memswap_limit of xstockstrat-indicators are both 2147483648
    Then the render oracle passes
    When either is deleted or set to a different value
    Then the render oracle reports the label "mem-limit:xstockstrat-indicators" and prints no value

  @AC-11 @FR-1 @regression
  Scenario: Memory that evades VmData accounting is still killed
    Given the watchdog is active
    When a formula grows a shared-anonymous mapping, or touches pages and then makes them read-only,
      or a runtime reports no VmData, past the headroom above the child's baseline
    Then it fails with exit_reason "memory_exceeded"
    And the same holds for a formula using only the production default imports that reaches ctypes by attribute traversal

  @AC-12 @FR-1 @regression
  Scenario: The arming handoff cannot be forged or inherited by a concurrent run
    Given an armed run whose child already wrote and closed its handoff
    When the formula writes its own H1 line to the old descriptor number
    Then the armed cap and baseline are unchanged
    And the handoff descriptor was passed only to that run's child
    And the baseline is the same with the headroom test seam on and off

  @AC-13 @FR-2 @regression
  Scenario: A failed probe is reported distinctly and the service still starts
    Given the probe child crashes, times out or returns a malformed line
    When the startup self-check runs
    Then an ERROR log record "sandbox memory probe failed" is emitted
    And no "sandbox memory cap not kernel-enforced" record is emitted
    And both gauges read 0
    And the service still starts and serves requests

  @AC-14 @FR-2 @regression
  Scenario: A runtime whose memory fields do not move is reported as unobservable
    Given the probe child maps and writes 16 MiB while the sampled VmData does not change
    When the startup self-check runs
    Then an ERROR log record "sandbox memory watchdog cannot observe child" is emitted
    And the memory-watchdog-observable gauge reads 0
    And the service still starts and serves requests
