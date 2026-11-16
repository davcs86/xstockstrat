Feature: ensure-signals-watchlist-on-read
  As a platform user, I want my system "Signals" watchlist to exist whenever I list my watchlists,
  so that I can see and use it before the first signal is auto-added.

  @AC-1 @FR-1
  Scenario: A user with no system list gets one on first list
    Given user "user-42" owns watchlists "DB workload test" and "Test" and no system-managed watchlist
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response contains 3 watchlists
    And exactly one has name "Signals" and system_managed true with 0 symbols

  @AC-2 @FR-1 @FR-2
  Scenario: Repeated and concurrent lists create exactly one system list
    Given user "user-42" has no system-managed watchlist
    When "user-42" calls ListWatchlists 5 times concurrently
    Then the user owns exactly 1 system-managed watchlist
    And every response contains that same watchlist_id

  @AC-3 @FR-3
  Scenario: Continuation pages never write
    Given user "user-42" has no system-managed watchlist
    When "user-42" calls ListWatchlists with page_token "00000000-0000-0000-0000-000000000000"
    Then no watchlist is inserted
    And the response contains no system-managed watchlist

  @AC-4 @FR-4
  Scenario: An ensure failure does not fail the list
    Given user "user-42" owns watchlist "Test" and the system-managed insert fails with "connection reset"
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response succeeds with 1 watchlist named "Test"
    And a WARN log contains "connection reset"

  @AC-5 @FR-5
  Scenario: An existing system list is not duplicated and keeps its symbols
    Given user "user-42" has a system-managed watchlist "Signals" holding symbol "AAPL" with source SIGNAL
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response contains that watchlist with symbol "AAPL" and no second system-managed watchlist

  @AC-7 @FR-6
  Scenario: With a small page_size the system list exists but may be on a later page
    Given user "user-42" owns watchlists "DB workload test" and "Test" and no system-managed watchlist
    When "user-42" calls ListWatchlists with page_size 1 and an empty page_token
    Then the response contains 1 watchlist and a non-empty next_page_token
    And following next_page_token until it is empty yields 3 watchlists, exactly one with system_managed true

  @AC-8 @FR-1
  Scenario: A caller with no x-user-id is rejected before any ensure
    Given a ListWatchlists request carrying no x-user-id header
    When the request is processed
    Then the call returns InvalidArgument "missing user identity"
    And no watchlist is inserted

  @AC-9 @FR-7
  Scenario: Agent docs no longer call list_watchlists purely read-only
    Given docs/runbooks/mcp-tools.md section "list_watchlists" and the docstring at services/xstockstrat-agent/app/tools.py line 33
    When either is read
    Then each states that the call idempotently ensures the caller's system "Signals" list
    And neither contains the bare phrase "(read-only"

  @AC-6 @FR-5
  Scenario: A same-named manual list coexists and delete stays guarded
    Given user "user-42" owns a manual watchlist named "Signals"
    When "user-42" calls ListWatchlists with an empty page_token
    Then the response contains two watchlists named "Signals", one with system_managed true
    And DeleteWatchlist on the system-managed one returns FAILED_PRECONDITION
