# Promoted from docs/roadmap/features/290-fix-ctx-cancel-warn-flood/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-290` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — GetBars cache write survives client departure without WARN flood (bug fix)
  Regression guard for defect report 2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md`): marketdata's GetBars cache-insert path WARN-floods after the client cancels.

  @AC-6 @FR-2 @regression @feature-290
  Scenario: Fetched bars are persisted after the client cancels, without a WARN
    Given a cold GetBars request for "AAPL" timeframe "1d" whose live fetch returns 2 bars
    And the client cancels the request after the live fetch
    When fetchAndCacheBars runs
    Then the bar store receives the 2 bars with timeframe "1d" on a context that is not canceled and whose deadline is no later than 5 seconds after the bar store is called
    And no "GetBars: cache insert failed" WARN is logged and no re-read is made
    And the 2-bar live page is returned with no error

  @AC-7 @FR-2 @characterization @feature-290
  Scenario: A live client's cache write is not given a new deadline
    Given a cold GetBars request for "AAPL" with a live context that has no deadline
    When fetchAndCacheBars writes the fetched bars
    Then the bar store receives them on a context with no deadline while the client is live

  @AC-8 @FR-2 @characterization @feature-290
  Scenario: A genuine cache-insert failure with a live client still warns and returns the live page
    Given a cold GetBars request for "AAPL" with a live context and a bar store that fails the write
    When fetchAndCacheBars runs
    Then "GetBars: cache insert failed" is logged once at WARN
    And the 2-bar live page is returned with no error

  @AC-9 @FR-2 @regression @feature-290
  Scenario: Only one departed-client cache write runs at a time
    Given a departed-client cache write for "AAPL" is in flight and blocked
    When a second request for "MSFT" whose client has already left needs to cache its 2 bars
    Then the second write is skipped, no WARN is logged and the 2-bar live page is returned
    And after the first write completes a third departed-client write is performed

  @AC-11 @FR-2 @characterization @feature-290
  Scenario: A genuine cache-insert failure after the client has left still warns
    Given a cold GetBars request for "AAPL" timeframe "1d" returning 2 bars and the client has already left
    And the detached cache write fails
    When fetchAndCacheBars runs
    Then "GetBars: cache insert failed" is logged once at WARN
    And the 2-bar live page is returned with no error

  @AC-12 @FR-2 @regression @feature-290
  Scenario: A client leaving mid-write does not cancel the persist
    Given a cold GetBars request for "AAPL" timeframe "1d" returning 2 bars with a live client
    And the cache write is in flight
    When the client cancels during the write
    Then the write context is not canceled by the departure and the bars are persisted with timeframe "1d"
    # expiry of the 5-second grace on a mid-write departure is an accepted, untested residual (the constant is not injectable, C-18)
    And no WARN is logged, no re-read is made and the 2-bar live page is returned
