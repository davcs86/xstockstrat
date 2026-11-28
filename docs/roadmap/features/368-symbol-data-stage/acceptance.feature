Feature: symbol-data-stage
  As the platform operator, I want a daily data stage on the analysis job graph that brings every
  universe symbol's bars and fundamentals up to date and records a coverage verdict per symbol,
  so that evaluation runs only on complete data and no backfill is manual.

  # @AC-49 is unused. Times are America/New_York unless marked Z.

  Background:
    Given analysis.pipeline.worker_enabled is true
    And analysis.pipeline.data_stage_enabled is true
    And analysis.pipeline.data_stage_delay_minutes is 30
    And analysis.pipeline.max_attempts is 5
    And the last closed session is 2026-11-27, closed at 16:00

  @AC-1 @FR-1
  Scenario: The universe snapshot is the union of positions, signals and watchlists per user
    Given user "u1" owns a strategy
    And user "u1" holds "AAPL", has an active signal on "NVDA" and a watchlist containing "MSFT" and "AAPL"
    When the universe job for session 2026-11-27 completes
    Then the snapshot lists exactly "AAPL", "MSFT" and "NVDA" for user "u1"
    And "AAPL" is marked held for user "u1"

  @AC-2 @FR-1
  Scenario: Two instances create one run per session
    Given 2 instances with the data stage enabled
    When both ensure the run for session 2026-11-27 at 16:31
    Then exactly 1 run row exists for session 2026-11-27
    And exactly 1 universe job exists for pass 1 of session 2026-11-27

  @AC-3 @FR-1
  Scenario: A user whose read fails on every attempt is left out without losing the others
    Given users "u1" and "u2" each own a strategy
    And the watchlist read fails for user "u1" on every attempt and succeeds for user "u2"
    When the universe job for session 2026-11-27 finishes its attempt 5
    Then the snapshot lists user "u2"'s symbols and no symbol for user "u1"
    And user "u1" is recorded as not snapshotted with failed source "watchlist"

  @AC-4 @FR-2
  Scenario: A symbol shared by two users gets one data job per pass
    Given users "u1" and "u2" both have "MSFT" in a watchlist
    When pass 1 of session 2026-11-27 has created its jobs
    Then exactly 1 data job exists for "MSFT" with epoch "2026-11-27#1"

  @AC-5 @FR-2
  Scenario: A symbol held by any user runs in the held lane
    Given user "u1" holds "AAPL" and user "u2" only watches "AAPL"
    And user "u2" only watches "MSFT"
    When pass 1 of session 2026-11-27 has created its jobs
    Then the data job for "AAPL" is in lane "held"
    And the data job for "MSFT" is in lane "watchlist"

  @AC-6 @FR-3 @FR-4 @FR-8 @FR-9
  Scenario: A symbol with complete history is covered after one final fetch
    Given "AAPL" has daily bars for every session of the 730-day window before 2026-11-27
    And the vendor returns a bar for "AAPL" on 2026-11-27 with close 190.00
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the final fetch for 2026-11-27 returned written and no history fetch is made
    And exactly 1 coverage read is made
    And the coverage record for "AAPL" and 2026-11-27 has bar verdict "covered"
    And exactly 1 bar record exists for "AAPL" and 2026-11-27 with captured close 190.00

  @AC-7 @FR-4
  Scenario: A symbol missing recent sessions is fetched without operator action
    Given the latest daily bar of "NVDA" is 2026-11-24
    And the vendor has bars for "NVDA" on 2026-11-25 and 2026-11-27
    When the data job for "NVDA" and session 2026-11-27 runs
    Then a history fetch covering 2026-11-25 is made
    And the coverage record has bar verdict "covered"
    And exactly 1 bar record exists for "NVDA" and 2026-11-27

  @AC-8 @FR-3 @FR-4
  Scenario: An interior hole is fetched
    Given "MSFT" has daily bars for 2026-11-25, 2026-11-24 and 2026-11-20 but none for 2026-11-23
    And the vendor has a bar for "MSFT" on 2026-11-23 and on 2026-11-27
    When the data job for "MSFT" and session 2026-11-27 runs
    Then a history fetch covering 2026-11-23 is made
    And the coverage record has bar verdict "covered"

  @AC-9 @FR-5 @FR-9
  Scenario: A symbol the vendor has nothing for gets the no-vendor-data verdict
    Given "ZZZZ" has no daily bars
    And the final fetch and the history fetch for "ZZZZ" both return outcome "EMPTY"
    When the data job for "ZZZZ" and session 2026-11-27 finishes
    Then the coverage record for "ZZZZ" and 2026-11-27 has bar verdict "no_vendor_data"
    And no bar record exists for "ZZZZ" and 2026-11-27
    And 2026-11-27 is not stored as a confirmed hole for "ZZZZ"

  @AC-10 @FR-5 @FR-14
  Scenario: A fetch that keeps failing ends as fetch_failed, not in the dead-letter state
    Given every BackfillBars call for "NVDA" fails with UNAVAILABLE
    When all 4 passes of session 2026-11-27 have finished
    Then the coverage record for "NVDA" and 2026-11-27 has bar verdict "fetch_failed" with reason "rpc"
    And no bar record and no confirmed hole exist for "NVDA"
    And every data job for "NVDA" is in state "succeeded"

  @AC-11 @FR-6
  Scenario: A due filings check fetches new filings and a symbol that is not due is left alone
    Given the filings check of "AAPL" is due on 2026-11-27
    And "MSFT" has no filings check row and its newest stored filing period ended 2026-10-28
    When the data jobs for "AAPL" and "MSFT" run for session 2026-11-27
    Then BackfillFundamentals is called for "AAPL" and not for "MSFT"
    And "MSFT" gets a filings check row whose next check is on or after 2027-02-10

  @AC-12 @FR-6
  Scenario: A failed filings fetch does not change the bar verdict
    Given "AAPL" is covered for session 2026-11-27 and its filings check is due
    And the newest stored filing period of "AAPL" ended 2026-08-10
    And the BackfillFundamentals call for "AAPL" fails with UNAVAILABLE
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the job succeeds
    And the coverage record has bar verdict "covered" and fundamentals state "fresh"
    And the next filings check of "AAPL" is between 2026-12-04 and 2026-12-10
    And exactly 1 bar record exists for "AAPL" and 2026-11-27

  @AC-13 @FR-7
  Scenario: A deployment with no stored source serves EDGAR
    Given no stored row exists for marketdata.fundamentals.snapshot_source
    When the fundamentals of the SEC filer "AAPL" are requested
    Then the returned snapshot has source "edgar"

  @AC-14 @FR-7
  Scenario: A non-filer falls back to the vendor
    Given marketdata.fundamentals.snapshot_source is "edgar"
    And "TSM" has no producible EDGAR snapshot
    When the fundamentals of "TSM" are requested
    Then the returned snapshot has the configured vendor as its source

  @AC-15 @FR-8
  Scenario: Running a data job again keeps one coverage record and one bar record
    Given the data job for "AAPL" and session 2026-11-27 already recorded "covered"
    When a data job for "AAPL" and session 2026-11-27 runs again
    Then exactly 1 coverage record exists for "AAPL" and 2026-11-27 and it is unchanged
    And exactly 1 bar record exists for "AAPL" and 2026-11-27
    And no BackfillBars call is made by the second job

  @AC-16 @FR-10
  Scenario: No run is created on a non-trading day
    Given today is Saturday 2026-11-28
    When the data stage ensures its run
    Then no run row exists for session 2026-11-28
    And the session used is 2026-11-27

  @AC-17 @FR-10
  Scenario: A market holiday is not a session
    Given Thursday 2026-11-26 was a market holiday
    And "AAPL" has daily bars for 2026-11-25 and every earlier session of the window, and none for 2026-11-26
    And the vendor returns a bar for "AAPL" on 2026-11-27
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the coverage record for "AAPL" and 2026-11-27 has bar verdict "covered"
    And no history fetch is made

  @AC-18 @FR-11
  Scenario: The kill switch stops creation and lets created jobs finish
    Given pass 1 of session 2026-11-27 has created 3 data jobs and 1 of them has not started
    When analysis.pipeline.data_stage_enabled is set to false
    Then the 3 data jobs run to completion
    And no further pass is created for session 2026-11-27
    And no run row is created for the next session while the switch is false

  @AC-19 @FR-11
  Scenario: Existing responses do not change
    Given ListOpportunities for user "u1" returned opportunities for "AAPL" and "MSFT" before the stage ran
    And GetWatchlistReadiness for user "u1" returned state "READY" for "AAPL" before the stage ran
    And no bar, signal, strategy or position changed
    When the data stage runs for session 2026-11-27 and both RPCs are called again
    Then ListOpportunities for user "u1" returns the same opportunities with the same conviction values
    And GetWatchlistReadiness for user "u1" returns state "READY" for "AAPL"

  @AC-20 @FR-12
  Scenario: A session reports its verdict counts
    Given a run in which 3 symbols end "covered" and 1 ends "no_vendor_data", and 2 of them needed a history fetch
    When the run is done
    Then the coverage records for the session count 3 "covered" and 1 "no_vendor_data"
    And telemetry reports 3 symbols with verdict covered, 1 with verdict no_vendor_data and 2 history fetches

  @AC-21 @FR-7
  Scenario: A stored source value is not changed by the feature
    Given the stored global value of marketdata.fundamentals.snapshot_source is "vendor" in production
    When the feature is deployed
    Then the stored value is still "vendor"
    And the key's seeded default is "edgar"
    And the fundamentals of "AAPL" are served with the configured vendor as their source

  @AC-22 @FR-6
  Scenario: With the filings backfill disabled the state still comes from stored filings
    Given marketdata's historical fundamentals are disabled
    And the newest stored filing period of "TSM" ended 2026-05-11 and its filings check is due
    When the data job for "TSM" and session 2026-11-27 runs
    Then the job succeeds
    And the coverage record for "TSM" has fundamentals state "stale"
    And the filings check row records outcome "disabled" and a next check between 2026-12-04 and 2026-12-10

  @AC-23 @FR-5
  Scenario: A symbol skipped as delisted gets the no-vendor-data verdict
    Given the latest daily bar of "DLST" is 2026-11-10
    And the final fetch for "DLST" returns outcome "SKIPPED"
    When the data job for "DLST" and session 2026-11-27 finishes
    Then the coverage record for "DLST" and 2026-11-27 has bar verdict "no_vendor_data"
    And no bar record exists for "DLST" and 2026-11-27

  @AC-24 @FR-3
  Scenario: A confirmed hole is not fetched again and the symbol is covered
    Given "THIN" has a confirmed hole from 2026-11-12 to 2026-11-12 and bars for every other session before 2026-11-27
    And the vendor returns a bar for "THIN" on 2026-11-27
    When the data job for "THIN" and session 2026-11-27 runs
    Then no history fetch is made
    And the coverage record for "THIN" and 2026-11-27 has bar verdict "covered"

  @AC-25 @FR-4 @FR-9
  Scenario: A bar written during the session does not count without a post-close fetch
    Given marketdata stores a bar for "AAPL" on 2026-11-27 written at 15:55
    And the final fetch for "AAPL" returns outcome "EMPTY"
    When the data job for "AAPL" and session 2026-11-27 runs
    Then the coverage record has bar verdict "no_vendor_data"
    And no bar record exists for "AAPL" and 2026-11-27

  @AC-26 @FR-10
  Scenario: No run starts before the close plus the delay
    When the data stage ensures its run at 16:29 on 2026-11-27
    Then no run row exists for session 2026-11-27
    When the data stage ensures its run at 16:30
    Then exactly 1 run row exists for session 2026-11-27

  @AC-27 @FR-6
  Scenario: A due filing is checked at most once per 7 days
    Given the filings check of "AAPL" was made on 2026-11-27 and no new filing was found
    When data jobs for "AAPL" run for the sessions 2026-11-30 to 2026-12-03
    Then BackfillFundamentals is not called for "AAPL" in those sessions

  @AC-28 @FR-6
  Scenario: A symbol with no filings is re-checked every 28 days and reads unavailable
    Given "SPY" has no stored filings and its filings check ran on 2026-11-27
    When data jobs for "SPY" run for every session until 2026-12-24
    Then BackfillFundamentals is not called for "SPY" in those sessions
    And each coverage record for "SPY" has fundamentals state "unavailable"

  @AC-29 @FR-1
  Scenario: A user without strategies is not snapshotted
    Given user "u3" holds "AAPL" and owns no strategy
    When the universe job for session 2026-11-27 completes
    Then no snapshot row and no user row exist for "u3"

  @AC-30 @FR-1
  Scenario: A system-scope signal is in every snapshotted user's universe
    Given users "u1" and "u2" each own a strategy and neither has "NVDA" in positions, watchlists or own signals
    And an active system-scope signal exists for "NVDA"
    When the universe job for session 2026-11-27 completes
    Then "NVDA" is a universe symbol of the session for both "u1" and "u2", not held
    And a data job exists for "NVDA"

  @AC-31 @FR-1
  Scenario: An empty universe succeeds with no data jobs
    Given no user owns a strategy
    When the universe job for session 2026-11-27 runs
    Then the job succeeds
    And no shard job and no data job exist for session 2026-11-27
    And the run is marked done

  @AC-32 @FR-11
  Scenario: The live loop's watchlist drain is unchanged at the page cap
    Given a user's watchlists span 51 pages
    When the live loop drains that user's watchlist
    Then it returns the symbols of the first 50 pages
    And no drain failure is counted and no warning is logged

  @AC-33 @FR-8
  Scenario: A replay after a committed no-vendor-data verdict starts no second fetch
    Given the data job for "ZZZZ" and session 2026-11-27 committed "no_vendor_data" and crashed before reporting
    When the job is run again
    Then no BackfillBars call is made
    And exactly 1 coverage record exists for "ZZZZ" and 2026-11-27

  @AC-34 @FR-2
  Scenario: A large universe is split into shards
    Given the snapshot for session 2026-11-27 has 1200 distinct symbols
    When pass 1 has created its jobs
    Then exactly 3 shard jobs exist and each has at most 500 data jobs
    And exactly 1200 data jobs exist

  @AC-35 @FR-5
  Scenario: A dead data job does not stop its siblings
    Given a shard with data jobs for "AAPL" and "MSFT" and the job for "AAPL" ends in state "dead"
    When the pass finishes
    Then the coverage record for "MSFT" exists
    And "AAPL" has no coverage record for the session

  @AC-36 @FR-8
  Scenario: Old session rows are pruned
    Given analysis.pipeline.retention_days is 7
    And coverage, bar, snapshot, run and finality rows exist for session 2026-10-20
    When the universe job for pass 1 of session 2026-11-27 runs
    Then no row for session 2026-10-20 remains in those tables
    And rows for session 2026-10-29 remain

  @AC-37 @FR-10
  Scenario: The calendar RPC answers after the close
    When GetLastClosedSession is called with as_of 2026-11-27 16:15
    Then it returns session date "2026-11-27"
    And closed_at 2026-11-27T21:00:00Z, day_start 2026-11-27T05:00:00Z and day_end 2026-11-28T04:59:59Z

  @AC-38 @FR-10
  Scenario: Changing the delay does not affect a run already started
    Given the run for session 2026-11-27 was created at 16:30 with delay 30
    When analysis.pipeline.data_stage_delay_minutes is set to 120 at 16:40
    Then the run row still records closed_at 16:00 and delay 30
    And no data job of the run fails or is deferred because of the change

  @AC-39 @FR-10
  Scenario: A missed session gets no run and its bars are fetched by the next run
    Given analysis is down from 2026-11-25 15:00 to 2026-11-27 17:00
    And the latest daily bar of "NVDA" is 2026-11-24 and the vendor has bars for 2026-11-25 and 2026-11-27
    When analysis is back and the stage runs
    Then no run row exists for session 2026-11-25
    And a run row exists for session 2026-11-27
    And the history fetch for "NVDA" covers 2026-11-25

  @AC-40 @FR-11
  Scenario: The kill switch at the start of a universe job
    Given the pass-1 universe job for session 2026-11-27 exists and has not started
    When analysis.pipeline.data_stage_enabled is set to false and the job runs
    Then the job succeeds
    And no snapshot row and no shard job exist for session 2026-11-27

  @AC-41 @FR-1
  Scenario: A complete snapshot is reused, never rewritten
    Given the snapshot for session 2026-11-27 is complete
    When the universe job of pass 2 runs
    Then no portfolio or ingest read is made
    And the snapshot rows are unchanged

  @AC-42 @FR-12
  Scenario: A long confirmed hole is visible
    Given the vendor has no bars for "TINY" from 2026-09-01 to 2026-10-30 and bars on every other session
    When the data job for "TINY" and session 2026-11-27 runs
    Then a warning "long hole confirmed" is logged for "TINY"
    And the confirmed-holes counter with kind "long" increases by 1
    And the coverage record for "TINY" has 1 confirmed gap

  @AC-43 @FR-10
  Scenario: A half-day session runs at the usual time
    Given the market closes at 13:00 on 2026-11-27
    When the data stage ensures its run
    Then the run row for session 2026-11-27 is created at 16:30, not earlier

  @AC-44 @FR-1
  Scenario: A failed read on an early attempt writes nothing and is retried
    Given the watchlist read fails for user "u1" on attempt 1 of the universe job
    When attempt 1 ends
    Then no snapshot row exists for session 2026-11-27
    And the universe job is retried

  @AC-45 @FR-14
  Scenario: An outage is recovered by a later pass
    Given "NVDA" is in the snapshot
    And every marketdata call is UNAVAILABLE from 16:25 to 17:05
    When the stage runs for session 2026-11-27
    Then pass 1 at 16:30 and pass 2 at 17:00 write no coverage record for "NVDA"
    And pass 3 at 17:30 records bar verdict "covered" for "NVDA"
    And the run is marked done

  @AC-46 @FR-14
  Scenario: A fetch failure defers the symbol to the next pass
    Given in pass 1 the fetch for "NVDA" fails on attempts 1 and 2 and every other symbol is recorded
    When pass 1 finishes
    Then the data job for "NVDA" is in state "succeeded" and no coverage record exists for "NVDA"
    And the deferred-fetch counter with reason "rpc" increases by 1
    And pass 2 creates a data job for "NVDA" and for no other symbol

  @AC-47 @FR-14
  Scenario: A dead data job is retried by the next pass
    Given the pass-1 data job for "NVDA" ends in state "dead"
    When pass 2 has created its jobs
    Then a data job for "NVDA" exists with epoch "2026-11-27#2"

  @AC-48 @FR-11
  Scenario: Stage fetches append no ledger events
    When marketdata receives a BackfillBars call carrying the caller "analysis-data-stage" from the analysis service identity
    Then no "marketdata.backfill.started", "marketdata.backfill.completed" or "marketdata.backfill.failed" event is appended
    When marketdata receives a BackfillBars call without that caller
    Then "marketdata.backfill.started" and "marketdata.backfill.completed" are appended

  @AC-50 @FR-14
  Scenario: A run is done even when a symbol never got a record
    Given all 4 passes of session 2026-11-27 have finished and the pass-4 data job for "ZZZZ" is dead
    When the stage checks the run
    Then the run is marked done
    And "ZZZZ" has no coverage record for the session

  @AC-51 @FR-13
  Scenario: A sampled bar that did not change is a match
    Given the run for session 2026-11-27 is done and "AAPL" is sampled with captured close 190.00 and volume 1000000
    When at 08:00 on 2026-11-28 the vendor returns the same open, high, low and close and volume 1000000
    Then the finality result for "AAPL" is "match"
    And the finality counter with result "drift" does not increase

  @AC-52 @FR-13
  Scenario: A changed bar is recorded as drift without touching the records
    Given the run for session 2026-11-27 is done and "AAPL" and "MSFT" are sampled
    When the vendor now returns close 190.40 for "AAPL" instead of 190.00, and volume 5% higher for "MSFT"
    Then the finality results for "AAPL" and "MSFT" are "drift"
    And the finality counter with result "drift" increases by 2
    And no notify alert is emitted
    And the coverage and bar records of both symbols are unchanged

  @AC-53 @FR-13
  Scenario: A corporate-action rescale is recorded as adjusted
    Given "SPLT" is sampled with captured open 100.00, high 104.00, low 98.00, close 102.00 and volume 1000000
    When the vendor now returns open 50.00, high 52.00, low 49.00, close 51.00 and volume 2000000
    Then the finality result for "SPLT" is "adjusted"
    Given "DIVD" is sampled with captured open 3.00, high 3.05, low 2.95, close 3.00 and volume 500000
    When the vendor now returns open 2.99, high 3.03, low 2.94, close 2.985 and volume 500000
    Then the finality result for "DIVD" is "adjusted"

  @AC-54 @FR-13
  Scenario: An unreachable vendor makes the check unavailable, not a failure
    Given the run for session 2026-11-27 is done with 50 sampled symbols
    And marketdata is unavailable at 08:00 on 2026-11-28
    When the finality job runs
    Then 50 finality results are "unavailable"
    And the finality job is in state "succeeded"
    And the finality counter with result "drift" does not increase

  @AC-55 @FR-13
  Scenario: The finality check is created once, 16 hours after the close
    Given 2 instances and the run for session 2026-11-27 is done
    When both ensure at 07:59 on 2026-11-28
    Then no finality job exists for session 2026-11-27
    When both ensure at 08:00 on 2026-11-28
    Then exactly 1 finality job exists for session 2026-11-27

  @AC-56 @FR-13 @FR-11
  Scenario: The stage reads no bar or quote through a warming RPC
    When the data jobs and the finality job of session 2026-11-27 run
    Then no GetBars, BatchGetBars, GetLatestQuote, GetLatestQuotes, GetLatestPrice, BatchGetLatestPrice, GetFundamentals or GetFundamentalsMulti call is made

  @AC-57 @FR-13
  Scenario: The sample is bounded and stable
    Given 1200 symbols are covered for session 2026-11-27
    When the finality job runs
    Then exactly 50 finality results exist for the session
    When the finality job is run again
    Then the same 50 results exist and no result is counted twice

  @AC-58 @FR-13
  Scenario: BackfillBars returns the written bars only on request
    When marketdata receives a one-day BackfillBars call for "AAPL" with return_bars set
    Then the response carries the written bar of "AAPL"
    When marketdata receives the same call without return_bars
    Then the response carries no bars
    When marketdata receives a 10-day BackfillBars call with return_bars set
    Then the call is rejected with INVALID_ARGUMENT

  @AC-59 @FR-14
  Scenario: A job that starts past the pass budget defers without calling the vendor
    Given pass 1 of session 2026-11-27 was created at 16:30
    When the data job for "NVDA" starts its attempt at 17:01
    Then no marketdata call is made and no coverage record is written for "NVDA"
    And the deferred-fetch counter with reason "budget" increases by 1
    And pass 2 creates a data job for "NVDA"

  @AC-60 @FR-14 @FR-5
  Scenario: Past the budget on the last pass the symbol is recorded as fetch_failed
    Given pass 4 of session 2026-11-27 was created at 18:00
    When the data job for "NVDA" starts its attempt at 18:31
    Then the coverage record for "NVDA" has bar verdict "fetch_failed" with reason "budget" and fundamentals state "unavailable"
    And no marketdata call is made

  @AC-61 @FR-14
  Scenario: A run that is not done when the next session closes is abandoned
    Given the run for session 2026-11-25 is at pass 2 and not done
    When the last closed session becomes 2026-11-27
    Then a run row is created for session 2026-11-27
    And no pass 3 is created for session 2026-11-25 and its run stays not done

  @AC-62 @FR-1
  Scenario: A user not fully read within the read budget is left out
    Given users "u1" and "u2" each own a strategy
    And on the last attempt the position pages of "u1" stall until the 300-second read budget expires
    When the universe job finishes
    Then user "u1" is recorded as not snapshotted with failed source "budget"
    And every user fully read before the budget expired is snapshotted

  @AC-63 @FR-14
  Scenario: A job requeued after the run is done writes nothing
    Given the run for session 2026-11-27 is done and "NVDA" has no coverage record
    When an operator requeues the pass-2 data job for "NVDA"
    Then the job succeeds without a marketdata call
    And no coverage record and no bar record exist for "NVDA" and 2026-11-27

  @AC-64 @FR-14
  Scenario: A run with nothing pending is marked done at once
    Given pass 1 of session 2026-11-27 recorded every snapshot symbol by 16:36
    When the stage checks the run
    Then the run is marked done within 65 seconds, before 17:00

  @AC-65 @FR-14
  Scenario: A pass whose jobs are missing is created again
    Given the run row for session 2026-11-27 is at pass 2 and no job exists for that pass
    When the stage checks the run
    Then the pass-2 universe job is created

  @AC-66 @FR-8
  Scenario: Two jobs racing for one symbol leave one consistent record
    Given two data jobs for "AAPL" and session 2026-11-27 reach their write at the same time
    When both finish
    Then exactly 1 coverage record exists for "AAPL" and 2026-11-27
    And the confirmed holes and the filings check of "AAPL" are those written by the job whose coverage record was stored
