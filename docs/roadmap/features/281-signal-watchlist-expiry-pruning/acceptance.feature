Feature: signal-watchlist-expiry-pruning
  As a trader using the signal watchlist, I want entries whose backing signals have all expired
  to be removed automatically, so that the signal watchlist only contains symbols with a live signal.

  @AC-1 @FR-1
  Scenario: Recon confirms expired signal-sourced entries persist today
    Given a signal for "AAPL" ingested with direction "watchlist" and valid_until 2026-10-01T00:00:00Z
    And "AAPL" was added to the user's signal watchlist with source SIGNAL
    When the current time is 2026-10-31T00:00:00Z and no pruning feature exists
    Then "AAPL" is still present on the signal watchlist, and recon.md records the path:line evidence for that behavior

  @AC-2 @FR-2
  Scenario: Entry is removed once its only signal expires
    Given the signal watchlist contains "AAPL" with source SIGNAL
    And the only signal for ("user-1", "AAPL") has valid_until 2026-10-01T00:00:00Z
    When pruning runs at 2026-10-31T00:00:00Z
    Then "AAPL" is absent from the signal watchlist

  @AC-3 @FR-2
  Scenario: Entry is removed only after all of its signals expire
    Given the signal watchlist contains "MSFT" with source SIGNAL
    And ("user-1", "MSFT") has signal A with valid_until 2026-10-01T00:00:00Z and signal B with valid_until 2026-11-15T00:00:00Z
    When pruning runs at 2026-10-31T00:00:00Z
    Then "MSFT" is still present on the signal watchlist
    When pruning runs at 2026-11-16T00:00:00Z
    Then "MSFT" is absent from the signal watchlist

  @AC-4 @FR-3
  Scenario: Open-ended signal keeps its entry indefinitely
    Given the signal watchlist contains "NVDA" with source SIGNAL
    And the only signal for ("user-1", "NVDA") has no valid_until
    When pruning runs at 2027-10-31T00:00:00Z
    Then "NVDA" is still present on the signal watchlist

  @AC-5 @FR-4
  Scenario: Manual entries are never pruned
    Given the user's watchlist contains "TSLA" with source MANUAL
    And a signal for "TSLA" with valid_until 2026-10-01T00:00:00Z has expired
    When pruning runs at 2026-10-31T00:00:00Z
    Then "TSLA" is still present on the watchlist

  @AC-6 @FR-5
  Scenario: Repeated pruning is idempotent
    Given "AAPL" was already pruned from the signal watchlist at 2026-10-31T00:00:00Z
    When pruning runs again at 2026-10-31T00:05:00Z
    Then the call succeeds with 0 entries removed and no error

  @AC-7 @FR-6
  Scenario: Each removal is observable
    Given the signal watchlist contains "AAPL" with source SIGNAL whose only signal expired at 2026-10-01T00:00:00Z
    When pruning removes "AAPL" at 2026-10-31T00:00:00Z
    Then an audit record exists naming user "user-1", symbol "AAPL", and the expired signal's id
