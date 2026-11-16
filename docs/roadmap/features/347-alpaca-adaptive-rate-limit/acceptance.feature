Feature: alpaca-adaptive-rate-limit
  As a platform operator, I want the Alpaca clients to pace themselves from Alpaca's own rate-limit
  headers and to wait out a 429 instead of failing, so that backfills, bar ingestion, quote reads and
  order calls keep working at whatever quota the account's plan actually has.

  @AC-1 @FR-1 @FR-2
  Scenario: An exhausted window holds the next request until the reset time
    Given the marketdata Alpaca client received a 200 from the data host with "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 3 seconds in the future
    When a bars request for "AAPL" is made with a 30 second deadline
    Then the request reaches the data host no earlier than the reset time
    And the caller receives the bars with no error

  @AC-2 @FR-1
  Scenario: Hosts are tracked independently
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 5 seconds in the future for the data host
    And it recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 150" and "X-RateLimit-Reset" 30 seconds in the future for the trading API host
    When an assets request is made to the trading API host
    Then the assets request is sent without waiting for the data host's reset

  @AC-3 @FR-2
  Scenario: A low remaining count spreads requests instead of bursting
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 4" and "X-RateLimit-Reset" 4 seconds in the future for the data host
    And the data host answers every request with 200 and no "X-RateLimit-*" headers
    When 4 bars requests are issued at the same moment, each with a 30 second deadline
    Then the first is sent at once and the others wait at least 1, 2 and 3 seconds
    And all 4 are sent before the reset time

  @AC-4 @FR-3
  Scenario: A 429 is retried after the reset and the caller sees success
    Given the data host answers the first bars request for "MSFT" with 429 and "X-RateLimit-Reset" 2 seconds in the future
    And it answers the second attempt with 200 and 3 bars
    When a bars request for "MSFT" is made with a 30 second deadline
    Then the second attempt is sent no earlier than the reset time
    And the caller receives 3 bars with no error

  @AC-5 @FR-3
  Scenario: A 429 without a reset header backs off exponentially with jitter
    Given the data host answers three consecutive attempts with 429 and no "X-RateLimit-Reset" header, then 200
    When a bars request is made with a 60 second deadline
    Then the waits before attempts 2, 3 and 4 are at least 1, 2 and 4 seconds
    And the caller receives the 200 response with no error

  @AC-6 @FR-3
  Scenario: Retries stop at the caller's deadline
    Given the data host answers every attempt with 429 and "X-RateLimit-Reset" 10 seconds in the future
    When a latest-quote request for "NVDA" is made with a 2500 millisecond deadline
    Then the caller receives an error within 3 seconds
    And the error message contains "rate limited" and "data.alpaca.markets"

  @AC-7 @FR-4
  Scenario: The static ceiling still caps the rate when headers allow more
    Given "marketdata.backfill.rate_limit_rps" is 5
    And the data host reports "X-RateLimit-Limit: 10000", "X-RateLimit-Remaining: 10000" and "X-RateLimit-Reset" 60 seconds in the future on every response
    When 15 bars requests are issued at the same moment
    Then exactly 5 are sent at once
    And the 10th is sent no earlier than 1.0 second after the first, within a 100 millisecond tolerance
    And the 15th is sent no earlier than 2.0 seconds after the first, within a 100 millisecond tolerance

  @AC-8 @FR-5
  Scenario: Missing or malformed headers leave behavior unchanged
    Given the data host answers 200 with no "X-RateLimit-*" headers, then 200 with "X-RateLimit-Remaining: abc", then 200 with "X-RateLimit-Remaining: 0" and no "X-RateLimit-Reset", then 200 with no "X-RateLimit-*" headers
    When four bars requests are made one after another
    Then all four callers receive their bars with no error
    And no request is delayed beyond the static limiter

  @AC-9 @FR-6
  Scenario: The marketdata kill switch restores the previous behavior
    Given "marketdata.alpaca.adaptive_rate_limit_enabled" is false
    And the data host answers a bars request with 429 and "X-RateLimit-Reset" 2 seconds in the future
    When a bars request is made with a 30 second deadline
    Then exactly 1 attempt is sent
    And the caller receives an error starting with "alpaca bars 429" within 1 second

  @AC-10 @FR-6
  Scenario: The trading kill switch restores the previous behavior
    Given "trading.broker.adaptive_rate_limit_enabled" is false
    And the broker host answers "GET /v2/account" with 429
    When the account is fetched
    Then exactly 1 attempt is sent
    And the caller receives an error containing "status 429"

  @AC-11 @FR-7
  Scenario: Other vendors are not affected
    Given the FMP host answers a quote request with 429 and "X-RateLimit-Reset" 2 seconds in the future
    When a fundamentals fetch calls FMP
    Then exactly 1 FMP attempt is sent
    And the FMP daily budget reservation is refunded as before

  @AC-12 @FR-8
  Scenario: A rate-limited order submit creates exactly one order
    Given the broker host answers the first "POST /v2/orders" with 429 and a reset 1 second in the future
    And it answers the second attempt with 200 and broker order id "b-1"
    When a MARKET order for 10 shares of "AAPL" with client_order_id "c-42" is submitted
    Then both attempts carry client_order_id "c-42" and an identical JSON body
    And the caller receives broker order id "b-1"
    And exactly one order intent is finalized for "c-42"
    And the same flow with a LIMIT order for 10 shares of "AAPL" at 150.00 also yields exactly one order

  @AC-13 @FR-8 @FR-3
  Scenario Outline: A broker call never outlives its retry budget
    Given "trading.broker.timeout_ms" is <timeout_ms> and "trading.order_intent.stale_multiplier" is <multiplier>, so the staleness threshold is <threshold_s> seconds and the call budget is <budget_s> seconds
    And retry jitter is fixed at 0 and the client clock advances only by its waits
    And the broker host answers every "POST /v2/orders" attempt with 429 and no "X-RateLimit-Reset" header
    When a MARKET order for 10 shares of "AAPL" is submitted on a context with no deadline
    Then exactly <attempts> attempts are sent, the last <last_start_s> seconds after the first
    And the caller receives an error containing "rate limited" within 100 milliseconds of <last_start_s> seconds after the call began, below <threshold_s> seconds

    Examples:
      | timeout_ms | multiplier | threshold_s | budget_s | attempts | last_start_s |
      | 5000       | 3.0        | 30          | 20       | 5        | 15           |
      | 5000       | 1.5        | 15          | 5        | 1        | 0            |
      | 10000      | 1.5        | 15          | 10       | 1        | 0            |
      | 1000       | 3.0        | 30          | 28       | 6        | 23           |

  @AC-14 @FR-9
  Scenario: Throttling is visible in telemetry and logs
    Given the data host answers a bars request with 429 and a reset 2 seconds in the future, then 200
    When the bars request completes
    Then "marketdata.vendor.requests" has one point with vendor "alpaca", op "bars", outcome "http_429"
    And one point with vendor "alpaca", op "bars", outcome "ok"
    And one WARN log names the data host and the wait duration

  @AC-15 @FR-8
  Scenario: A rate-limited cancel takes effect exactly once
    Given the broker host answers the first "DELETE /v2/orders/b-1" with 429 and a reset 1 second in the future
    And it answers the second attempt with 204
    When order "b-1" is canceled
    Then exactly 2 DELETE attempts are sent for "b-1"
    And the caller receives no error

  @AC-16 @FR-8
  Scenario: A rate-limited replace is retried with the same body
    Given the broker host answers the first "PATCH /v2/orders/b-1" with 429 and a reset 1 second in the future
    And it answers the second attempt with 200 and broker order id "b-2"
    When order "b-1" is replaced with quantity 7
    Then both PATCH attempts carry an identical JSON body with qty "7"
    And the caller receives broker order id "b-2"

  @AC-17 @FR-10
  Scenario: Paper and live hosts are handled the same and tracked separately
    Given a paper broker client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 5 seconds in the future for "paper-api.alpaca.markets"
    When a live broker client fetches the account from "api.alpaca.markets" and the host answers 429 then 200
    Then the live request is sent without waiting for the paper host's reset
    And the live caller receives the account after exactly 2 attempts

  @AC-18 @FR-9
  Scenario: Trading logs a throttled window
    Given a paper broker client, and the broker host answers "GET /v2/positions" with 429 and a reset 2 seconds in the future, then 200
    When positions are fetched
    Then one WARN log names host "paper-api.alpaca.markets" and the wait duration

  @AC-19 @FR-3 @FR-9
  Scenario: Retries are bounded when the caller has no deadline
    Given the data host answers every attempt with 429 and "X-RateLimit-Reset" 3600 seconds in the future
    When a bars request for "AAPL" is made on a context with no deadline
    Then exactly 2 attempts are sent, the second no earlier than 60 seconds after the first
    And the caller receives an error containing "rate limited" and "data.alpaca.markets" no later than 90 seconds after the call began
    And "marketdata.vendor.requests" has 2 points with outcome "http_429" and one point with outcome "throttle" and no duration

  @AC-20 @FR-1
  Scenario: Credentials are tracked independently on the same host
    Given broker client "A" with API key "KEY-A" recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 5 seconds in the future for "paper-api.alpaca.markets"
    And broker client "B" uses API key "KEY-B" on the same host
    When broker client "B" fetches the account
    Then the account request from "B" is sent without waiting for "A"'s reset

  @AC-21 @FR-9
  Scenario Outline: A wait ended by the request context is recorded as ctx
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 10 seconds in the future for the data host
    When a latest-quote request for "NVDA" is made with a 2500 millisecond deadline and <ending>
    Then "marketdata.vendor.requests" has exactly one point with vendor "alpaca", op "quotes_latest", outcome "ctx" and no duration
    And no request for "NVDA" reaches the data host
    And the caller receives an error containing "rate limited" and "data.alpaca.markets" that wraps <context_error>

    Examples:
      | ending                            | context_error            |
      | the deadline passes               | context.DeadlineExceeded |
      | the caller cancels after 1 second | context.Canceled         |

  @AC-22 @FR-4
  Scenario: A zero static ceiling disables only the ceiling
    Given "marketdata.backfill.rate_limit_rps" is 0
    And the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and a reset 3 seconds in the future for the data host
    When a bars request for "AAPL" is made with a 30 second deadline
    Then the request reaches the data host no earlier than the reset time

  @AC-23 @FR-2
  Scenario: A trading read that cannot outwait a hold is refused without a request
    Given a paper broker client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 10 seconds in the future for "paper-api.alpaca.markets"
    And "trading.broker.timeout_ms" is 5000
    When positions are fetched on a context with a 5 second deadline
    Then no request reaches "paper-api.alpaca.markets"
    And within 100 milliseconds the caller receives an error that is broker.ErrRateLimited and contains "rate limited" and "paper-api.alpaca.markets"

  @AC-24 @FR-2
  Scenario: A caller that cannot wait for its spread slot is sent at once
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 4" and "X-RateLimit-Reset" 4 seconds in the future for the data host
    And the data host answers every request with 200 and no "X-RateLimit-*" headers
    And a bars request with a 30 second deadline has just been sent in the first spread slot
    When a latest-quote request for "NVDA" is made with a 500 millisecond deadline
    Then the "NVDA" request reaches the data host with no wait
    And the caller receives the quote with no error

  @AC-25 @FR-8
  Scenario: A rate-limited submit is not abandoned when the caller cancels
    Given the broker host answers the first "POST /v2/orders" with 429 and no "X-RateLimit-Reset" header
    And it answers the second attempt with 200 and broker order id "b-7"
    When a MARKET order for 10 shares of "AAPL" is submitted and the caller cancels its request 500 milliseconds later
    Then 2 "POST /v2/orders" attempts are sent with the same client_order_id
    And the order is persisted with broker order id "b-7" and is not REJECTED
    And its order intent is finalized Completed

  @AC-26 @FR-8
  Scenario: A submit whose caller deadline leaves no room for a retry is rejected as rate limited
    Given "trading.broker.timeout_ms" is 5000
    And the broker host answers the first "POST /v2/orders" with 429 and "X-RateLimit-Reset" 2 seconds in the future
    When a MARKET order for 10 shares of "AAPL" is submitted on a context with a 3 second deadline
    Then exactly 1 "POST /v2/orders" attempt is sent
    And the caller receives an error containing "rate limited"
    And the order is REJECTED, an "order.broker_rejected" event is emitted and its order intent is finalized Rejected

  @AC-27 @FR-8
  Scenario: An attempt that times out inside a retry stays uncertain
    Given "trading.broker.timeout_ms" is 1000
    And the broker host answers the first "POST /v2/orders" with 429 and no "X-RateLimit-Reset" header
    And it sends no response to the second attempt for 3 seconds
    When a MARKET order for 10 shares of "AAPL" is submitted
    Then 2 "POST /v2/orders" attempts are sent
    And the order is not REJECTED, its order intent stays PENDING and an "order.broker_call_uncertain" event is emitted

  @AC-28 @FR-8
  Scenario: A rate-limited emergency flatten halts the account first and keeps retrying
    Given account "acct-1" holds 10 shares of "AAPL" whose bracket is past its protection deadline
    And "trading.order.max_retries" is 3
    And the broker host answers the first "POST /v2/orders" with 429, "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 50 seconds in the future
    When the emergency flatten runs for the position
    Then account "acct-1" is halted before the second flatten submit is made
    And 4 flatten orders are recorded REJECTED, and the 4 flatten submits carried 4 distinct client order ids
    And exactly 1 "POST /v2/orders" reaches the broker host
    And account "acct-1" is still halted afterwards

  @AC-29 @FR-8
  Scenario: A rate-limited cancel leaves the order unchanged and an identical retry really retries
    Given order "ord-1" of user "user-1" is NEW with broker order id "b-1" on an Alpaca account and intent state COMPLETED
    And the broker refuses the first cancel of "b-1" with a rate-limit error and accepts the second
    When "user-1" cancels "ord-1"
    Then the caller receives Unavailable with a message containing "refused by the broker rate limit; the order is unchanged"
    And "ord-1" is still NEW with intent state COMPLETED, no CANCELED write is persisted and no "order.canceled" event is emitted
    And no cancel intent row remains for "ord-1"
    And one WARN names order_id "ord-1", broker_order_id "b-1" and the cancel intent id
    When "user-1" sends the identical cancel again
    Then a second cancel of "b-1" reaches the broker and "ord-1" is CANCELED

  @AC-30 @FR-8
  Scenario: A rate-limited cancel whose intent was already reclaimed reports the intent as unknown
    Given order "ord-1" of user "user-1" is NEW with broker order id "b-1" on an Alpaca account
    And while the cancel of "b-1" is at the broker, the cancel intent row is moved to UNKNOWN, as the sweeper does, and the broker then refuses the cancel with a rate-limit error
    When "user-1" cancels "ord-1"
    Then the caller receives Unavailable with a message containing "could not be released; verify with the broker before retrying"
    And "ord-1" is still NEW with intent state UNKNOWN
    And an identical cancel is answered FailedPrecondition containing "outcome is unknown" without a broker call

  @AC-31 @FR-8
  Scenario: A rate-limited replace leaves the order unchanged and an identical retry really retries
    Given order "ord-1" of user "user-1" is NEW for 10 shares with broker order id "b-1" on an Alpaca account
    And the broker refuses the first replace of "b-1" with a rate-limit error and accepts the second
    When "user-1" replaces "ord-1" with quantity 7
    Then the caller receives Unavailable with a message containing "refused by the broker rate limit; the order is unchanged"
    And "ord-1" still has quantity 10 and no replace intent row remains
    When "user-1" sends the identical replace again
    Then a second replace of "b-1" reaches the broker and "ord-1" has quantity 7

  @AC-32 @FR-11
  Scenario: Warm-quote writes keep the loop context after a late multi fetch
    Given warm symbols "AAA", "BBB" and "CCC" and a quote cache that rejects writes on a done context
    And "marketdata.stream.warm_interval_ms" is 200
    And the multi-symbol quote fetch returns quotes for all 3 symbols only once its context is done
    When the warm-quote poller runs one cycle
    Then quotes for "AAA", "BBB" and "CCC" are cached
    And one "loop tick ok" record is written for loop "warm_quote"
    And no per-symbol quote request is made
    And the multi-symbol quote fetch carried a deadline 200 milliseconds after the cycle began, within 50 milliseconds

  @AC-33 @FR-11
  Scenario: Bar ingest starts no fetch after the cycle deadline and never counts skipped symbols as empty
    Given warm symbols "AAA", "BBB" and "CCC" and "marketdata.stream.bar_ingest_backoff_ms" 21600000
    And the multi-symbol bars fetch fails
    And "marketdata.stream.bar_ingest_interval_ms" is 200
    And each per-symbol bars fetch returns an error only once its context is done, or after 2 seconds
    When the bar-ingest poller runs one cycle
    Then exactly 1 per-symbol bars request is made in the cycle
    And none of "AAA", "BBB" or "CCC" starts or extends a no-bars hold

  @AC-34 @FR-11
  Scenario: The fill poller does not stall on a throttled Alpaca account
    Given an Alpaca paper account with 3 open orders and "trading.broker.timeout_ms" 5000
    And the broker host answered its "GET /v2/account" with 200, "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 10 seconds in the future
    When the fill poller runs one tick
    Then no "GET /v2/orders/{id}" request reaches the broker host
    And the tick ends within 100 milliseconds with 3 logged GetOrder failures
    And no "loop tick ok" record is written for loop "fill_poller"

  @AC-35 @FR-11 @FR-8
  Scenario: Bracket-leg cancels make one bounded attempt after the cancel is recorded
    Given order "ord-1" of user "user-1" is PARTIALLY_FILLED with broker order id "b-1" on an Alpaca paper account
    And it has an ACTIVE bracket with legs "leg-stop" and "leg-tp"
    And the broker host answers "DELETE /v2/orders/b-1" with 204
    And it answers each leg DELETE with 429 carrying only "X-RateLimit-Reset" 10 seconds in the future
    When "user-1" cancels "ord-1"
    Then exactly 1 DELETE is sent for "leg-stop" and exactly 1 for "leg-tp"
    And when the first leg DELETE reaches the broker host, "ord-1" has already been written CANCELED and its cancel intent is finalized Completed
    And the caller receives success within 1 second
    And one WARN per leg names the leg id

  @AC-36 @FR-11
  Scenario: The not-cancelable re-read is bounded by one broker timeout
    Given order "ord-1" of user "user-1" is NEW with broker order id "b-1" on an Alpaca paper account
    And the broker host answers "DELETE /v2/orders/b-1" with 422
    And it answers "GET /v2/orders/b-1" with 429 carrying only "X-RateLimit-Reset" 10 seconds in the future
    When "user-1" cancels "ord-1"
    Then exactly 1 "GET /v2/orders/b-1" is sent
    And within 1 second the caller receives Unavailable containing "could not be read"
    And "ord-1" has intent state UNKNOWN and is not CANCELED

  @AC-37 @FR-6
  Scenario: The kill switches are seeded on and the ceiling description changes only when untouched
    Given the config migration "alpaca_adaptive_rate_limit_keys" is applied twice
    Then namespace "marketdata" key "alpaca.adaptive_rate_limit_enabled" and namespace "trading" key "broker.adaptive_rate_limit_enabled" each have exactly one global row in "staging" and one in "production" with value_type "bool" and value "true"
    And the seeded description of "backfill.rate_limit_rps" equals the new ceiling description text fixed in the implementation spec
    And a "backfill.rate_limit_rps" description edited by an operator is left unchanged
