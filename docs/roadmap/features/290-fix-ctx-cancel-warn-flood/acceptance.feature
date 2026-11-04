Feature: fix-ctx-cancel-warn-flood (bug fix)
  Regression guard for defect report 2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect: portfolio (and marketdata) keep working and WARN-flooding after the context is canceled.

  @AC-1 @FR-1 @regression
  Scenario: A canceled context stops the position-sync loop after the first upsert
    Given an offline position-sync event for account "acc-1" with 3 positions "AAPL", "MSFT" and "NVDA"
    And the handler context is canceled right after the upsert of "AAPL" succeeds
    When processPositionSync handles the event
    Then exactly 1 repository write was made and no DELETE and no realized-P&L write followed
    And the returned error matches context.Canceled and no WARN is logged

  @AC-2 @FR-1 @regression
  Scenario: A write that discovers the cancellation stops the loop without a WARN
    Given an offline position-sync event for account "acc-1" with 3 positions "AAPL", "MSFT" and "NVDA"
    And the first repository write (the upsert of "AAPL") cancels the context and fails with the context error
    When processPositionSync handles the event
    Then exactly 1 write was attempted and no DELETE was issued
    And no WARN is logged and the returned error matches context.Canceled

  @AC-3 @FR-1 @regression
  Scenario: A canceled offline sync through the retry wrapper is never parked and the cursor is withheld
    Given an offline position-sync event for account "acc-1" and a context that is already done
    When the event is handled through boundedRetry
    Then the handler returns a non-nil error matching context.Canceled, which withholds the stream cursor
    And no offline_account_realized write is made and no "event parked" Error is logged

  @AC-4 @FR-1 @characterization
  Scenario: A genuine write failure with a live context still warns
    Given a broker position-sync event for account "brk-1" with the position "AAPL" qty 10 and a live context
    And the upsert of "AAPL" fails with a driver-reported context.Canceled
    When processPositionSync handles the event
    Then "upsert position from sync failed" for symbol "AAPL" is logged at WARN

  @AC-5 @FR-1 @characterization
  Scenario: The empty-broker-snapshot skip path is unchanged by a done context
    Given a broker position-sync event for account "brk-1" with no positions and a context that is already done
    When processPositionSync handles the event
    Then no repository call is made and the handler returns nil

  @AC-6 @FR-2 @regression
  Scenario: Fetched bars are persisted after the client cancels, without a WARN
    Given a cold GetBars request for "AAPL" timeframe "1d" whose live fetch returns 2 bars
    And the client cancels the request after the live fetch
    When fetchAndCacheBars runs
    Then the bar store receives the 2 bars with timeframe "1d" on a context that is not canceled and whose deadline is no later than 5 seconds after the call
    And no "GetBars: cache insert failed" WARN is logged and no re-read is made
    And the 2-bar live page is returned with no error

  @AC-7 @FR-2 @characterization
  Scenario: A live client's cache write is not given a new deadline
    Given a cold GetBars request for "AAPL" with a live context that has no deadline
    When fetchAndCacheBars writes the fetched bars
    Then the bar store receives them on a context with no deadline while the client is live

  @AC-8 @FR-2 @characterization
  Scenario: A genuine cache-insert failure with a live client still warns and returns the live page
    Given a cold GetBars request for "AAPL" with a live context and a bar store that fails the write
    When fetchAndCacheBars runs
    Then "GetBars: cache insert failed" is logged once at WARN
    And the 2-bar live page is returned with no error

  @AC-9 @FR-2 @regression
  Scenario: Only one departed-client cache write runs at a time
    Given a departed-client cache write for "AAPL" is in flight and blocked
    When a second request for "MSFT" whose client has already left needs to cache its 2 bars
    Then the second write is skipped, no WARN is logged and the 2-bar live page is returned
    And after the first write completes a third departed-client write is performed

  @AC-10 @FR-1 @regression
  Scenario: A canceled broker sync stops without writing and returns the cancellation
    Given a broker position-sync event for account "brk-1" with one position "AAPL" qty 10 and a context that is already done
    When processPositionSync handles the event
    Then the returned error matches context.Canceled and no repository call is made
    And no WARN is logged

  @AC-11 @FR-2 @characterization
  Scenario: A genuine cache-insert failure after the client has left still warns
    Given a cold GetBars request for "AAPL" timeframe "1d" returning 2 bars and the client has already left
    And the detached cache write fails
    When fetchAndCacheBars runs
    Then "GetBars: cache insert failed" is logged once at WARN
    And the 2-bar live page is returned with no error

  @AC-12 @FR-2 @regression
  Scenario: A client leaving mid-write does not cancel the persist
    Given a cold GetBars request for "AAPL" timeframe "1d" returning 2 bars with a live client
    And the cache write is in flight
    When the client cancels during the write
    Then the write completes within 5 seconds and the bars are persisted with timeframe "1d"
    And no WARN is logged, no re-read is made and the 2-bar live page is returned
