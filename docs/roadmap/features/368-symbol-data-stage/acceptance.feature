Feature: symbol-data-stage
  As the platform operator, I want a daily data stage on the analysis job graph that brings every
  universe symbol's bars and fundamentals up to date and records a coverage verdict per symbol,
  so that evaluation runs only on complete data and no backfill is manual.

  Background:
    Given analysis.pipeline.worker_enabled is true
    And analysis.pipeline.data_stage_enabled is true
    And the last closed session is 2026-11-27

  @AC-1 @FR-1
  Scenario: The universe snapshot is the union of positions, signals and watchlists per user
    Given user "u1" holds "AAPL", has an active signal on "NVDA" and a watchlist containing "MSFT" and "AAPL"
    When the universe run for session 2026-11-27 completes
    Then the snapshot lists exactly "AAPL", "MSFT" and "NVDA" for user "u1"
    And "AAPL" is marked held for user "u1"

  @AC-2 @FR-1
  Scenario: Two instances create one universe run per session
    Given 2 instances with the data stage enabled
    When both ensure the universe run for session 2026-11-27
    Then exactly 1 universe run exists for session 2026-11-27

  @AC-3 @FR-1
  Scenario: One user's failed source read does not lose another user's snapshot
    Given the watchlist read fails for user "u1" and succeeds for user "u2"
    When the universe run for session 2026-11-27 runs
    Then the snapshot lists user "u2"'s symbols
    And the run records user "u1" as not snapshotted

  @AC-4 @FR-2
  Scenario: A symbol shared by two users gets one data job
    Given users "u1" and "u2" both have "MSFT" in a watchlist
    When the universe run for session 2026-11-27 completes
    Then exactly 1 data job exists for "MSFT" and session 2026-11-27

  @AC-5 @FR-2
  Scenario: A symbol held by any user runs in the held lane
    Given user "u1" holds "AAPL" and user "u2" only watches "AAPL"
    And user "u2" only watches "MSFT"
    When the universe run for session 2026-11-27 completes
    Then the data job for "AAPL" is in lane "held"
    And the data job for "MSFT" is in lane "watchlist"

  @AC-6 @FR-3 @FR-8 @FR-9
  Scenario: A symbol with current bars is covered and gets one bar record
    Given "AAPL" has a daily bar for 2026-11-27 and no interior hole
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the coverage record for "AAPL" and 2026-11-27 has bar verdict "covered"
    And exactly 1 bar record exists for "AAPL" and 2026-11-27
    And no backfill is started

  @AC-7 @FR-4
  Scenario: A symbol missing the last session is backfilled without operator action
    Given the latest daily bar of "NVDA" is 2026-11-24
    And the vendor has bars for 2026-11-25 to 2026-11-27
    When the data job for "NVDA" and session 2026-11-27 runs
    Then a gaps-only backfill is started for "NVDA"
    And after the backfill completes the coverage record has bar verdict "covered"
    And exactly 1 bar record exists for "NVDA" and 2026-11-27

  @AC-8 @FR-3 @FR-4
  Scenario: An interior hole is backfilled
    Given "MSFT" has daily bars for 2026-11-27 and 2026-11-20 but none for 2026-11-23
    When the data job for "MSFT" and session 2026-11-27 runs
    Then a gaps-only backfill is started for "MSFT" covering 2026-11-23

  @AC-9 @FR-5 @FR-9
  Scenario: A symbol the vendor has nothing for ends with a terminal verdict
    Given "ZZZZ" has no daily bars
    And the backfill for "ZZZZ" completes with outcome "EMPTY"
    When the data job for "ZZZZ" and session 2026-11-27 finishes
    Then the coverage record for "ZZZZ" and 2026-11-27 has bar verdict "no_vendor_data"
    And no bar record exists for "ZZZZ" and 2026-11-27
    And no second backfill is started for "ZZZZ" in session 2026-11-27

  @AC-10 @FR-5
  Scenario: A backfill that keeps failing ends in the dead-letter state
    Given analysis.pipeline.max_attempts is 5
    And every backfill attempt for "NVDA" fails with a transient error
    When 5 attempts have failed
    Then the backfill job for "NVDA" is in state "dead"
    And no bar record exists for "NVDA" and 2026-11-27

  @AC-11 @FR-6
  Scenario: A stale fundamentals snapshot is refreshed and a fresh one is left alone
    Given the fundamentals snapshot of "AAPL" is 30 hours old and the freshness window is 24 hours
    And the fundamentals snapshot of "MSFT" is 2 hours old
    When the data jobs for "AAPL" and "MSFT" run
    Then the fundamentals of "AAPL" are refreshed and its coverage record has fundamentals state "fresh"
    And no fundamentals source call is made for "MSFT"

  @AC-12 @FR-6
  Scenario: A fundamentals failure does not change the bar verdict
    Given "AAPL" has a daily bar for 2026-11-27 and no interior hole
    And the fundamentals refresh for "AAPL" fails
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the job succeeds
    And the coverage record has bar verdict "covered" and fundamentals state "unavailable"
    And exactly 1 bar record exists for "AAPL" and 2026-11-27

  @AC-13 @FR-7
  Scenario: A deployment that never set the source serves EDGAR
    Given no value was ever set for marketdata.fundamentals.snapshot_source
    When the fundamentals of the SEC filer "AAPL" are requested
    Then the returned snapshot has source "edgar"

  @AC-14 @FR-7
  Scenario: A non-filer falls back to the vendor
    Given marketdata.fundamentals.snapshot_source is "edgar"
    And "TSM" has no producible EDGAR snapshot
    When the fundamentals of "TSM" are requested
    Then the returned snapshot has the configured vendor as its source

  @AC-15 @FR-8
  Scenario: Re-running a data job keeps one coverage record and one bar record
    Given the data job for "AAPL" and session 2026-11-27 already succeeded
    When the same job is run again
    Then exactly 1 coverage record exists for "AAPL" and 2026-11-27
    And exactly 1 bar record exists for "AAPL" and 2026-11-27

  @AC-16 @FR-10
  Scenario: No run is created on a non-trading day
    Given today is Saturday 2026-11-28
    When the data stage ensures its run
    Then no universe run exists for session 2026-11-28
    And the session used is 2026-11-27

  @AC-17 @FR-10
  Scenario: A market holiday is not a session
    Given Thursday 2026-11-26 was a market holiday
    And "AAPL" has daily bars for 2026-11-27 and 2026-11-25 and none for 2026-11-26
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the coverage record for "AAPL" and 2026-11-27 has bar verdict "covered"
    And no backfill is started

  @AC-18 @FR-11
  Scenario: The kill switch stops the stage
    Given analysis.pipeline.data_stage_enabled is false
    When a trading session closes
    Then no universe run and no data job is created for that session

  @AC-19 @FR-11
  Scenario: Existing responses do not change
    Given the data stage has run for session 2026-11-27
    When ListOpportunities and GetWatchlistReadiness are called
    Then each response is computed by the same code path as before this feature

  @AC-20 @FR-12
  Scenario: A run reports its verdict counts
    Given a run with 3 symbols ending "covered" and 1 ending "no_vendor_data" after 2 backfills
    When the run completes
    Then telemetry reports 3 covered, 1 no_vendor_data and 2 backfills started for that run
