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
  Scenario: Entry is removed once its only agent-recorded signal expires
    Given the signal watchlist contains "AAPL" with source SIGNAL
    And the only agent-recorded watchlist signal (id 101) for ("user-1", "AAPL") since the entry was added has valid_until 2026-10-01T00:00:00Z
    When the prune runs at 2026-10-31T00:00:00Z
    Then "AAPL" is absent from the signal watchlist

  @AC-3 @FR-2
  Scenario: Entry is removed only after all of its agent-recorded signals expire
    Given the signal watchlist contains "MSFT" with source SIGNAL
    And ("user-1", "MSFT") has agent-recorded watchlist signals A (id 201, valid_until 2026-10-01T00:00:00Z) and B (id 202, valid_until 2026-11-15T00:00:00Z), each from a non-deduplicated ingest
    When the prune runs at 2026-10-31T00:00:00Z
    Then "MSFT" is still present on the signal watchlist
    When the prune runs at 2026-11-16T00:00:00Z
    Then "MSFT" is absent from the signal watchlist

  @AC-4 @FR-3
  Scenario: An entry recorded by an open-ended signal is never removed by the recurring prune
    Given the signal watchlist contains "NVDA" with source SIGNAL
    And the agent-recorded watchlist signal for ("user-1", "NVDA") was ingested with no valid_until
    When the prune runs at 2027-10-31T00:00:00Z
    Then "NVDA" is still present on the signal watchlist

  @AC-5 @FR-4
  Scenario: Manual entries are never pruned
    Given the user's watchlist contains "TSLA" with source MANUAL
    And a signal for "TSLA" with valid_until 2026-10-01T00:00:00Z has expired
    When the prune runs at 2026-10-31T00:00:00Z
    Then "TSLA" is still present on the watchlist

  @AC-6 @FR-5
  Scenario: Repeated pruning is idempotent
    Given "AAPL" was already pruned from the signal watchlist at 2026-10-31T00:00:00Z
    When the prune runs again at 2026-10-31T00:05:00Z
    Then the tick completes with 0 entries removed, no error, and no ledger event

  @AC-7 @FR-6
  Scenario: An expiry removal is observable
    Given the signal watchlist contains "AAPL" with source SIGNAL whose only tracked signal (id 101) expired at 2026-10-01T00:00:00Z
    When the prune removes "AAPL" at 2026-10-31T00:00:00Z
    Then a ledger event "portfolio.watchlist.signal_entry_expired" exists naming user "user-1", symbol "AAPL", and signal_id 101

  @AC-8 @FR-2 @FR-3
  Scenario: A renewed signal extends the entry's life
    Given "AMD" is on user-1's signal watchlist tracked by signal 101 with valid_until 2026-11-01T00:00:00Z
    When the agent records a non-deduplicated watchlist signal 102 for "AMD" with valid_until 2026-12-01T00:00:00Z
    And the prune runs at 2026-11-15T00:00:00Z
    Then "AMD" is still present
    When the prune runs at 2026-12-02T00:00:00Z
    Then "AMD" is absent and the expired event names signal_id 102

  @AC-9 @FR-3
  Scenario Outline: A SIGNAL add without dated provenance untracks the entry
    Given "INTC" is on user-1's signal watchlist tracked with valid_until 2026-10-01T00:00:00Z
    When a SIGNAL add for "INTC" arrives with <provenance>
    And the prune runs at 2026-10-31T00:00:00Z
    Then "INTC" is still present and has no expiry record
    Examples:
      | provenance                                                                  |
      | no signal_provenance (an open-ended signal 103, or a pre-feature agent)     |

  @AC-10 @FR-2 @FR-3
  Scenario: Non-agent and non-watchlist signals do not keep an entry alive
    Given "AAPL" is tracked on user-1's signal watchlist with valid_until 2026-10-01T00:00:00Z
    And user-1 has a live "buy" signal and an mcp_client-ingested "watchlist" signal for "AAPL", both valid until 2027-01-01T00:00:00Z
    When the prune runs at 2026-10-31T00:00:00Z
    Then "AAPL" is absent from the signal watchlist

  @AC-11 @FR-4
  Scenario: A manual add does not pin a signal entry
    Given "META" is on user-1's signal watchlist with source SIGNAL tracked with valid_until 2026-10-01T00:00:00Z
    When user-1 adds "META" to that watchlist with source MANUAL
    Then the "META" binding's source is still SIGNAL and its tracking is unchanged
    When the prune runs at 2026-10-31T00:00:00Z
    Then "META" is absent

  @AC-12 @FR-5
  Scenario: The prune never waits on a concurrent rebind
    Given "AAPL" is due for pruning on user-1's signal watchlist
    And an UpdateWatchlistBinding transaction holds the "AAPL" binding row
    When a prune tick runs on a connection with lock_timeout 500ms
    Then the tick completes without a lock-timeout or deadlock error and without removing "AAPL"
    And after the rebind commits the next tick removes "AAPL"

  @AC-13 @FR-6
  Scenario Outline: Each removal emits one owner-visible event of the right kind
    Given "<sym>" bound to strategy "strat-9" is on user-1's signal watchlist with <state>
    When the prune removes "<sym>" at 2026-10-31T00:00:00Z
    Then exactly one "<event>" ledger event is appended with request user_id "user-1" and a non-empty x-trace-id
    And its payload holds user_id "user-1", the watchlist_id, symbol "<sym>", strategy_id "strat-9"<extra>
    Examples:
      | sym  | state                                   | event                                              | extra                                                  |
      | AAPL | signal 101 expired 2026-10-01T00:00:00Z | portfolio.watchlist.signal_entry_expired           | , signal_id 101 and valid_until "2026-10-01T00:00:00Z" |
      | ORCL | a backfill untracked mark               | portfolio.watchlist.signal_entry_removed_untracked |                                                        |

  @AC-14 @FR-5
  Scenario Outline: The prune interval is bounded on write and clamped on read
    When portfolio.watchlist.signal_prune_interval_seconds is <value>
    Then <layer> <outcome>
    Examples:
      | value | layer                | outcome                            |
      | 0     | SetConfig            | rejects it (minimum 60)            |
      | 59    | SetConfig            | rejects it (minimum 60)            |
      | 60    | SetConfig            | accepts it                         |
      | 86400 | SetConfig            | accepts it                         |
      | 86401 | SetConfig            | rejects it (maximum 86400)         |
      | 0     | the prune loop read  | sleeps 300 seconds                 |
      | 30    | the prune loop read  | sleeps 60 seconds                  |
      | 90000 | the prune loop read  | sleeps 86400 seconds               |

  @AC-15 @FR-7
  Scenario: Backfill seeds expiry for existing entries from the owner's signal rows
    Given user-1's signal watchlist holds SIGNAL "AAPL" with no expiry record
    And user-1 has watchlist signals for " aapl" (id 7, valid_until 2026-12-01T00:00:00Z) and "AAPL" (id 5, valid_until 2026-09-01T00:00:00Z)
    When the DBA runs REPORT with --legacy-owner "SEED"
    Then nothing is written and REPORT lists seed AAPL valid_until 2026-12-01T00:00:00Z signal_id 7 with seed_expired 0
    When APPLY runs with --legacy-owner "SEED" --expect-seed-expired 0 --expect-untracked 0
    Then "AAPL" has an expiry record valid_until 2026-12-01T00:00:00Z and signal_id 7

  @AC-16 @FR-7
  Scenario: Strict untracked removal, including the accepted pre-224 legacy-owner case
    Given user-2's signal watchlist holds SIGNAL "PLTR" bound to "strat-3" with no expiry record
    And user-2 has no signal rows, while legacy owner "SEED" holds a live watchlist signal for "PLTR"
    When the DBA runs REPORT with --legacy-owner "SEED"
    Then REPORT lists untracked (user-2, the watchlist_id, "PLTR", "strat-3") with legacy_live Y and flags user-2 NO_OWN_SIGNALS
    When APPLY runs with --legacy-owner "SEED" --expect-untracked 0
    Then APPLY refuses before writing anything
    When APPLY runs with --legacy-owner "SEED" --expect-untracked 1 and the next prune tick runs
    Then "PLTR" is absent from user-2's signal watchlist and one signal_entry_removed_untracked event names user-2, "PLTR", "strat-3"

  @AC-17 @FR-7
  Scenario: A marked entry is rescued by a live signal before the next tick
    Given the backfill marked SIGNAL "ORCL" on user-1's signal watchlist as untracked
    When the agent records a non-deduplicated watchlist signal 110 for "ORCL" with valid_until 2026-12-01T00:00:00Z
    And the prune runs at 2026-11-01T00:00:00Z
    Then "ORCL" is still present, tracked by signal 110 with valid_until 2026-12-01T00:00:00Z
    When the agent instead records a watchlist signal 111 for "ORCL" whose valid_until 2026-10-15T00:00:00Z is already past
    Then the entry is removed on the next tick with a signal_entry_expired event, not rescued

  @AC-18 @FR-2
  Scenario Outline: Invalid signal provenance is rejected
    Given user-1 has a <list> list
    When AddWatchlistSymbols arrives with signal_provenance (signal_id <signal_id>, valid_until <valid_until>) and <bindings>
    Then the call fails with InvalidArgument and no binding or expiry record is written
    Examples:
      | list           | signal_id | valid_until           | bindings                         |
      | manual         | 101       | 2026-10-01T00:00:00Z  | one SIGNAL binding "AAPL"        |
      | system-managed | 101       | 2026-10-01T00:00:00Z  | two SIGNAL bindings              |
      | system-managed | 101       | 2026-10-01T00:00:00Z  | one MANUAL binding "AAPL"        |
      | system-managed | 0         | 2026-10-01T00:00:00Z  | one SIGNAL binding "AAPL"        |
      | system-managed | 101       | unset                 | one SIGNAL binding "AAPL"        |
