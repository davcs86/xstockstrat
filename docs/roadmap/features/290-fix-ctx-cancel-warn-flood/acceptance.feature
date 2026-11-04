Feature: fix-ctx-cancel-warn-flood (bug fix)
  Regression guard for defect report 2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect: portfolio (and marketdata) keep working and WARN-flooding after the context is canceled.

  @AC-1 @FR-1 @regression
  Scenario: A canceled context stops the position-sync loop after one error
    Given a position-sync event with several positions is being processed
    And the handler context is canceled after the first upsert
    When processPositionSync handles the event
    Then the handler returns the cancellation without issuing further repository calls
    And no per-symbol WARN lines are logged for the remaining positions or the delete step

  @AC-2 @FR-1 @regression
  Scenario: A write that discovers the cancellation stops the loop without a WARN
    Given a position-sync event with several positions
    And the first repository write itself cancels the context and fails with the context error
    When processPositionSync handles the event
    Then exactly one write was attempted and no delete was issued
    And no WARN is logged and the returned error matches context.Canceled

  @AC-3 @FR-1
  Scenario: A canceled offline sync through the retry wrapper is never parked
    Given an offline position-sync event and a context that is already done
    When the event is handled through boundedRetry
    Then the handler returns a non-nil error and UpsertOfflineRealized is not called
    And no "event parked" Error is logged

  @AC-4 @FR-1 @characterization
  Scenario: A genuine write failure with a live context still warns
    Given a position-sync event and a live context
    And a repository write that fails with a driver-reported context.Canceled
    When processPositionSync handles the event
    Then "upsert position from sync failed" is still logged at WARN

  @AC-5 @FR-1 @characterization
  Scenario: The empty-broker-snapshot skip path is unchanged by a done context
    Given a broker position-sync event with no positions and a context that is already done
    When processPositionSync handles the event
    Then no repository call is made and the handler returns nil

  @AC-6 @FR-2 @regression
  Scenario: Fetched bars are persisted after the client cancels, without a WARN
    Given a cold GetBars request whose live fetch returns bars
    And the client cancels the request after the live fetch
    When fetchAndCacheBars runs
    Then the bars are stored on a context that is not canceled and whose deadline is no later than the grace
    And the stored bars carry the canonical timeframe "1d"
    And no re-read is made, no cache-insert WARN is logged, and the live page is returned

  @AC-7 @FR-2 @regression
  Scenario: A live client's cache write is not given a new deadline
    Given a cold GetBars request with a live context that has no deadline
    When fetchAndCacheBars writes the fetched bars
    Then the write context has no deadline while the client is live

  @AC-8 @FR-2 @characterization
  Scenario: A genuine cache-insert failure with a live client still warns and returns the live page
    Given a cold GetBars request with a live context
    And the cache write fails
    When fetchAndCacheBars runs
    Then "GetBars: cache insert failed" is logged at WARN
    And the live page is returned with no error

  @AC-9 @FR-2
  Scenario: Only one departed-client cache write runs at a time
    Given one departed-client cache write is in flight
    When a second request whose client has already left needs to cache bars
    Then the second write is skipped without a WARN and the live page is returned
