Feature: opportunity-compute-robustness
  As a trader using the Decide queue, I want a symbol whose data is unavailable to show as an explicit
  "unavailable" state (not a misleadingly-quiet row), and the queue's interactive reads to stay
  responsive while a background recompute runs.

  @AC-1 @FR-1
  Scenario: A data-unavailable symbol is marked unavailable, not evaluated-0/0
    Given a candidate symbol whose bars/indicator fetch fails during an opportunities compute
    When the queue is materialized and ListOpportunities is read
    Then that symbol's row carries the terminal data-unavailable sentinel
    And it is distinguishable from a symbol that was evaluated with 0 of N conditions passing

  @AC-2 @FR-1
  Scenario: An evaluated-but-not-passing symbol is NOT marked unavailable
    Given a candidate symbol whose bars are available and 0 of 3 conditions pass
    When the queue is materialized
    Then that symbol is classified quiet/0-of-3 (evaluated), not data-unavailable

  @AC-3 @FR-2
  Scenario: The Decide queue renders the unavailable state explicitly
    Given ListOpportunities returns a row with the data-unavailable sentinel
    When the /insights/opportunities queue renders that row
    Then the row shows an explicit "unavailable" cue via the shared C-17 primitives
    And it is not rendered as a "quiet" 0/0 verdict

  @AC-4 @FR-3
  Scenario: A background recompute does not starve an interactive read
    Given a background opportunities recompute is running its bars-fetch fan-out
    When an interactive ListOpportunities read enriches live quotes at the same time
    Then the interactive read's bars-fetch concurrency is governed by a semaphore separate from the background compute's
    And the two do not contend on the same semaphore permits

  @AC-5 @FR-1
  Scenario: The sentinel survives the materialization round-trip
    Given a data-unavailable candidate is written to analysis.opportunities during a compute
    When the row is read back by a later ListOpportunities without recompute
    Then the data-unavailable sentinel is still present on the row (not lost through persistence)

  @AC-6 @FR-4
  Scenario: A cold ListOpportunities read does not block on a synchronous compute
    Given a user who has never had opportunities materialized (a cold queue)
    When that user's first ListOpportunities read arrives
    Then the read returns promptly without waiting for a synchronous compute under the per-user lock
    And it returns an empty page carrying a "computing" pending signal and kicks a background recompute
    And a subsequent poll returns the materialized rows once the background compute completes
