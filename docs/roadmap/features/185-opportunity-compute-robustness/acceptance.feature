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
  Scenario: A cold read is non-blocking and distinguishable from an empty universe
    Given a user who has never had opportunities materialized
    When ListOpportunities is called
    Then it returns an empty page with the "computing" pending signal set (not a synchronous compute wait)
    And a background recompute is kicked
    And a user whose universe is legitimately empty returns an empty page with "computing" NOT set

  @AC-7 @FR-4
  Scenario: A persistently-failing cold compute renders a terminal error, not an infinite spinner
    Given a cold user whose background recompute keeps failing
    When ListOpportunities is polled repeatedly
    Then after the bounded attempts it returns a terminal compute-failed state (not "computing" forever)

  @AC-8 @FR-5
  Scenario: A data-unavailable row self-heals via a surgical read-time recompute
    Given a served data-unavailable row older than the 300s retry cooldown
    When ListOpportunities is read and market data has recovered
    Then only that symbol's rows are re-fetched and re-evaluated (not the full universe)
    And the row heals in place with both conviction and signal_axis restored (signal_axis re-drained, not left 0)
    And a still-unavailable symbol has its computed_at re-stamped so it does not re-kick before the next 300s

  @AC-9 @FR-5
  Scenario: A recovered watchlist-entry symbol also refreshes the readiness cache
    Given a recovered symbol that participates in a watchlist x strategy entry-rule readiness
    When the surgical recovery re-evaluates it successfully
    Then the fresh readiness rows for that (symbol, strategy, entry) subset are upserted to analysis.readiness_cache
    And a symbol whose re-fetch still fails is NOT written to the readiness cache (success-only)

  @AC-10 @FR-6
  Scenario: The agent list_opportunities tool surfaces the data-unavailable state
    Given ListOpportunities returns a row with data_unavailable set
    When the list_opportunities MCP tool projects the response
    Then the projected row carries data_unavailable
    And the Opportunity descriptor-parity test asserts every proto field is projected (no silent drift)
