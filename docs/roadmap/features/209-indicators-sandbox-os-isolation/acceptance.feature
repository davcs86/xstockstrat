Feature: indicators-sandbox-os-isolation (OS-level containment of untrusted formula code)
  As a platform operator, I want untrusted formula code evaluated inside an OS-isolated context with no
  network, no writable filesystem beyond scratch, dropped capabilities, and hard resource limits, so
  that even a successful sandbox escape yields no lateral movement and legitimate formulas still work.

  @AC-1 @FR-1 @FR-2
  Scenario: An escaped formula cannot open an outbound network connection
    Given a malicious formula that escapes the language guard via ().__class__.__base__.__subclasses__() and attempts to open a socket to an external host
    When the indicators service evaluates it in the OS-isolated context
    Then the socket attempt fails because the evaluator has no network namespace access
    And no outbound connection leaves the evaluator

  @AC-2 @FR-2
  Scenario: An escaped formula cannot read secrets or the service filesystem
    Given a malicious formula that, after escaping, attempts to read DATABASE_URL / a master key from the environment and to read a file outside the scratch area
    When it is evaluated in the OS-isolated context
    Then the environment exposes none of the service's DB credential or master keys (C-4 minimal env preserved)
    And reads outside the dedicated scratch/tmpfs area are denied

  @AC-3 @FR-3
  Scenario: An infinite-loop / memory-bomb formula is terminated deterministically
    Given a formula that spins in an unbounded loop and a second formula that allocates unbounded memory
    When each is evaluated
    Then each is terminated at its RLIMIT (wall-clock / CPU for the loop, address-space for the allocation)
    And the caller receives a typed evaluation error, and other indicators requests are unaffected

  @AC-4 @FR-4
  Scenario: A legitimate formula evaluates to the identical result as before isolation
    Given a valid indicator formula (e.g. a 14-period RSI over a provided price series) that evaluated successfully before this change
    When it is evaluated under OS isolation
    Then it returns the identical numeric result
    And the indicator-builder acceptance behavior is unchanged

  @AC-5 @FR-3
  Scenario: A fork-bomb formula cannot exhaust host process resources
    Given a formula that attempts to spawn processes without bound after escaping
    When it is evaluated in the OS-isolated context
    Then process creation is capped (RLIMIT_NPROC / pids limit) and the evaluation is terminated with a typed error
    And the indicators service remains responsive to concurrent legitimate evaluations

  @AC-6 @FR-5
  Scenario: Isolation limits are configured, not hardcoded magic numbers
    Given the sandbox isolation limits that are designated operator tunables
    When the service starts
    Then those limits are sourced from config/env (not inline literals in sandbox.py)
    And a fixed build-time constant of the jail is documented as such rather than presented as a tunable
