Feature: analysis-concurrency-offload
  As a platform operator launching xstockstrat for multiple concurrent users, I want the analysis and
  indicators services to parallelize bounded cross-service fan-out and run CPU-bound / blocking work
  off the event loop, so that list loads stay fast and per-user latency stays flat under concurrency.

  @AC-1 @FR-1
  Scenario: Opportunity compute fans out concurrently but yields the identical set
    Given a user whose opportunity universe selects 100 candidates
    And the pre-change serial compute returns an ordered opportunity list L
    When ListOpportunities recomputes the same universe with the concurrent fan-out
    Then the returned opportunities equal L in both membership and rank order
    And the number of concurrent in-flight marketdata GetBars calls never exceeds the configured bound

  @AC-2 @FR-2
  Scenario: EvaluateReadiness parallelizes per-symbol work under the shared bound
    Given a watchlist of 20 symbols bound to a single strategy
    When EvaluateReadiness is called for those 20 symbols
    Then the per-symbol bars fetches and traces run concurrently under analysis.opportunity.max_concurrent_bars_fetches
    And the readiness verdict for each symbol equals the verdict the serial implementation produced

  @AC-3 @FR-3
  Scenario: Per-component indicator calls run concurrently with deterministic output
    Given a strategy definition with 4 indicator/formula components
    When the StrategyEvaluator evaluates one symbol
    Then the 4 ComputeIndicator/ExecuteFormula calls are dispatched concurrently under the bound
    And the assembled component series are byte-identical to the serial evaluation

  @AC-4 @FR-4
  Scenario: A long backtest does not block another user's read
    Given user A starts a RunBacktest that occupies compute for 8 seconds
    When user B calls ListOpportunities 1 second into A's backtest
    Then user B's ListOpportunities returns within its normal latency budget
    And it does not wait for user A's backtest to complete

  @AC-5 @FR-5
  Scenario: Concurrent formula executions are no longer serialized to one at a time
    Given indicators.sandbox.max_concurrent is 4
    And 4 ExecuteFormula requests arrive simultaneously, each running a 2-second formula
    When they are processed
    Then all 4 run concurrently off the event loop and complete in about 2 seconds, not about 8 seconds
    And a formula exceeding indicators.sandbox.timeout_ms is still terminated at the timeout

  @AC-6 @FR-6
  Scenario: Parallelized fan-out preserves per-user owner scoping
    Given user A has a live strategy and user B does not
    When user B's opportunity queue is computed with the concurrent fan-out
    Then no opportunity attributed to user B references user A's live strategy
    And every concurrent compute branch carries user B's user_id owner scope
