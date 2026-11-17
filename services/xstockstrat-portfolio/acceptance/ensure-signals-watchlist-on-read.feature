# Promoted from docs/roadmap/features/351-ensure-signals-watchlist-on-read/acceptance.feature at
# integration (Constitution C-16). Source-feature provenance is carried on every scenario's feature-351
# tag. Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# NOTE: the source scenario numbered 9 (agent documentation wording) is a docs check, not a durable
# portfolio behavior, and is deliberately not promoted. Scenario 6 below is not a duplicate of scenario 6
# of consolidate-watchlist-signal.feature (feature 127): that rule covers the EnsureSignalWatchlist RPC;
# this one covers the ensure performed by ListWatchlists plus the delete guard on its result.

Feature: xstockstrat-portfolio — ListWatchlists ensures the caller's system "Signals" list
  What portfolio guarantees when a caller lists watchlists: a first page (empty page_token) that holds
  no system-managed list idempotently ensures it, fail-open, without writing on continuation pages or
  for an unidentified caller; the system list keeps its delete guard and occupies one cap slot.

  @AC-1 @FR-1 @feature-351
  Scenario: A user with no system list gets one on first list
    Given user "user-42" owns watchlists "DB workload test" and "Test" and no system-managed watchlist
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response contains 3 watchlists
    And exactly one has name "Signals" and system_managed true with 0 symbols

  @AC-2 @FR-1 @FR-2 @feature-351
  Scenario: Repeated and concurrent lists create exactly one system list
    Given user "user-42" has no system-managed watchlist
    When "user-42" calls ListWatchlists 5 times concurrently
    Then the user owns exactly 1 system-managed watchlist
    And every response contains that same watchlist_id

  @AC-3 @FR-3 @feature-351
  Scenario: Continuation pages never write
    Given user "user-42" has no system-managed watchlist
    When "user-42" calls ListWatchlists with page_token "00000000-0000-0000-0000-000000000000"
    Then no watchlist is inserted
    And the response contains no system-managed watchlist

  @AC-4 @FR-4 @feature-351
  Scenario: An ensure failure does not fail the list
    Given user "user-42" owns watchlist "Test" and the system-managed insert fails with "connection reset"
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response succeeds with 1 watchlist named "Test"
    And a WARN log contains "connection reset"

  @AC-5 @FR-5 @feature-351
  Scenario: An existing system list is not duplicated and keeps its symbols
    Given user "user-42" has a system-managed watchlist "Signals" holding symbol "AAPL" with source SIGNAL
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response contains that watchlist with symbol "AAPL" and no second system-managed watchlist

  @AC-6 @FR-5 @feature-351
  Scenario: A same-named manual list coexists and delete stays guarded
    Given user "user-42" owns a manual watchlist named "Signals"
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response contains two watchlists named "Signals", one with system_managed true
    And DeleteWatchlist on the system-managed one returns FAILED_PRECONDITION

  @AC-7 @FR-6 @feature-351
  Scenario: With a small page_size the system list is created exactly once but may not be in the response
    Given user "user-42" owns watchlists "DB workload test" and "Test" and no system-managed watchlist
    When "user-42" calls ListWatchlists with page_size 1 and an empty page_token
    Then the response contains 1 watchlist and a non-empty next_page_token
    And "user-42" owns exactly 1 system-managed watchlist afterwards
    And a second call with page_size 1 and an empty page_token creates no further watchlist

  @AC-8 @FR-1 @feature-351
  Scenario: A caller with no x-user-id is rejected before any ensure
    Given a ListWatchlists request carrying no x-user-id header
    When the request is processed
    Then the call returns InvalidArgument "missing user identity"
    And no watchlist is inserted

  @AC-10 @FR-8 @feature-351
  Scenario: The system list occupies one slot of the per-user cap
    Given watchlist.max_per_user is 50 and user "user-42" owns 49 manual watchlists and one system-managed watchlist
    When "user-42" calls CreateWatchlist with name "Breakouts"
    Then the call returns InvalidArgument "watchlist limit reached: 50"
    And "user-42" still owns 50 watchlists
