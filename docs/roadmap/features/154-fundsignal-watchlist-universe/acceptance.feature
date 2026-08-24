Feature: fundsignal-watchlist-universe
  As a platform operator, I want the fundamentals producer's watchlists universe source to score the
  real cross-user union of user watchlist symbols, so that the daily producer covers what users are
  actually watching without me maintaining an explicit_symbols CSV.

  @AC-1 @FR-1
  Scenario: Portfolio enumerates the distinct cross-user union of watchlist symbols
    Given user "alice" has a watchlist containing "AAPL, MSFT"
    And user "bob" has a watchlist containing "MSFT, NVDA"
    When an authorized internal caller invokes the cross-user watchlist-symbol enumeration RPC
    Then the response contains exactly the distinct set {"AAPL", "MSFT", "NVDA"}
    And "MSFT" appears once, not twice

  @AC-2 @FR-2
  Scenario: The enumeration RPC rejects a non-privileged caller
    Given a caller whose propagated metadata carries neither the admin access-scope bit nor an
      allow-listed internal-caller identity
    When it invokes the cross-user watchlist-symbol enumeration RPC
    Then the call fails with PERMISSION_DENIED
    And no watchlist symbols are returned

  @AC-3 @FR-3
  Scenario: Producer scores the enumerated union when universe_source is watchlists
    Given analysis.fundsignal.universe_source is "watchlists"
    And analysis.fundsignal.explicit_symbols is ""
    And the cross-user enumeration returns {"AAPL", "MSFT", "NVDA"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is ["AAPL", "MSFT", "NVDA"]
    And it is not empty (no fallback to the empty explicit CSV)

  @AC-4 @FR-4
  Scenario: Producer unions enumeration with explicit_symbols when universe_source is both
    Given analysis.fundsignal.universe_source is "both"
    And analysis.fundsignal.explicit_symbols is "TSLA, AAPL"
    And the cross-user enumeration returns {"AAPL", "MSFT"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is the de-duplicated union ["AAPL", "MSFT", "TSLA"]

  @AC-5 @FR-4
  Scenario: explicit source still ignores the enumeration entirely
    Given analysis.fundsignal.universe_source is "explicit"
    And analysis.fundsignal.explicit_symbols is "IBM"
    And the cross-user enumeration (if called) would return {"AAPL", "MSFT"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is ["IBM"]
    And the enumeration RPC is not consulted

  @AC-6 @FR-5
  Scenario: The enumerated universe is still capped and budget-bounded
    Given analysis.fundsignal.universe_source is "watchlists"
    And analysis.fundsignal.max_symbols_per_run is 2
    And the cross-user enumeration returns {"AAA", "BBB", "CCC"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe contains exactly 2 symbols
    And the surviving symbols are drawn from the de-duplicated enumerated set

  @AC-7 @FR-6
  Scenario: A portfolio enumeration outage does not crash the producer cycle
    Given analysis.fundsignal.universe_source is "watchlists"
    And the cross-user enumeration RPC raises an UNAVAILABLE error
    When the fundamentals producer resolves its universe for a cycle
    Then the cycle completes without raising
    And the resolved universe is empty
    And a warning is logged naming the enumeration failure
