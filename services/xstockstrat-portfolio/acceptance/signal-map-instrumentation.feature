# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (portfolio)

  @AC-8 @FR-3 @feature-294
  Scenario: Portfolio counts a stalled and a parked consumer event
    Given the position-sync consumer's boundedRetry handler and event "evt-9" whose handler fails with SQLSTATE 23505
    When the handler is invoked directly 5 times
    Then "portfolio.consumer.events" with consumer "position_sync" and outcome "error" increases by 4
    And "portfolio.consumer.events" with consumer "position_sync" and outcome "parked" increases by 1
    And the "event parked" ERROR names "evt-9"
    And "portfolio.consumer.events" with outcome "ok" does not change

  @AC-9 @FR-3 @feature-294
  Scenario: Portfolio reports an unavailable quote fetch and a skipped snapshot
    Given user "u-1" with one broker account "acc-1" that has an account_balances row, no offline accounts, and 2 positions on it with CurrentPrice 0 and source UNSPECIFIED
    And the marketdata GetLatestQuotes call blocks until its context deadline (portfolio.marketdata.quote_timeout_ms)
    When GetPortfolio is called for "u-1" and then broadcastSnapshot is invoked directly for "u-1"
    Then "portfolio.marketdata_fetch" with op "quotes" and outcome "timeout" increases by 2
    And "portfolio.snapshot" with outcome "skipped_unpriced" increases by 1
    And "portfolio.mark_source" with mark_source "none" increases by 2 for path "read" and by 2 for path "snapshot"
    And no "latest quote has no usable price" line is written
    And the RPC still returns OK

  @AC-10 @FR-3 @feature-294
  Scenario: A failed snapshot insert is logged instead of dropped
    Given InsertSnapshot returns a database error
    When broadcastSnapshot runs for a fully priced user
    Then "portfolio.snapshot" with outcome "db_error" increases by 1
    And an ERROR "portfolio snapshot insert failed" log contains the error message
    And the "portfolio.snapshot" ledger event is still emitted and a matching subscriber still receives the snapshot

  @AC-11 @FR-3 @feature-294
  Scenario: Portfolio logs one aggregated unusable-quote line per call
    Given a user whose accounts all have account_balances rows, holding 40 positions with CurrentPrice 0 and source UNSPECIFIED
    And GetLatestQuotes returns a quote for all 40 symbols, of which 12 have no mark_price and no two-sided bid and ask
    And no offline accounts exist for the user (ListOfflineAccountIdsByUser returns none)
    When GetPortfolio values the 40 positions inside an active trace span
    Then exactly 1 log line "latest quote has no usable price" is written for the call
    And it carries a trace_id and the count 12
    And "portfolio.mark_source" with mark_source "none" and path "read" increases by 12

  @AC-58 @FR-14 @feature-294
  Scenario: A portfolio consumer's reconnect counter restarts after a quiet period
    Given a portfolio consumer with an injected clock and sleep seam that has had 3 consecutive graceful closes
    And no event is delivered between the 3rd and 4th close
    When a 4th graceful close happens 11 minutes after the 3rd
    Then that close is logged at INFO with consecutive_graceful 1
    And no "stream resumed" line is written for it
    And the retry interval stays 2 seconds
