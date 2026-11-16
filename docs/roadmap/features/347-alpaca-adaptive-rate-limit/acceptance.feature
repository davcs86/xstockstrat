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
    Given the marketdata Alpaca client recorded "X-RateLimit-Remaining: 0" with a reset 5 seconds in the future for the data host
    And it recorded "X-RateLimit-Remaining: 150" for the trading API host
    When an assets request is made to the trading API host
    Then the assets request is sent without waiting for the data host's reset

  @AC-3 @FR-2
  Scenario: A low remaining count spreads requests instead of bursting
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 4" and a reset 4 seconds in the future
    When 4 bars requests are issued at the same moment
    Then the 4 requests are not all sent within the first second
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
    And the data host reports "X-RateLimit-Remaining: 10000" on every response
    When 15 bars requests are issued at the same moment
    Then exactly 5 are sent at once
    And the 10th is sent no earlier than 1.0 second after the first, within a 100 millisecond tolerance
    And the 15th is sent no earlier than 2.0 seconds after the first, within a 100 millisecond tolerance

  @AC-8 @FR-5
  Scenario: Missing or malformed headers leave behavior unchanged
    Given the data host answers 200 with no "X-RateLimit-*" headers, then 200 with "X-RateLimit-Remaining: abc", then 200 with "X-RateLimit-Remaining: 0" and no "X-RateLimit-Reset"
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

  @AC-13 @FR-8
  Scenario: A broker call never outlives the order-intent staleness bound
    Given the order-intent staleness threshold is 30 seconds ("trading.broker.timeout_ms" 5000, IBKRRequestTimeout 10 seconds, "trading.order_intent.stale_multiplier" 3.0)
    And the broker host answers every "POST /v2/orders" attempt with 429 and a reset 60 seconds in the future
    When a MARKET order for 10 shares of "AAPL" is submitted on a context with no deadline
    Then the caller receives an error containing "rate limited" in less than 30 seconds

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
    Given a paper broker client recorded "X-RateLimit-Remaining: 0" with a reset 5 seconds in the future for "paper-api.alpaca.markets"
    When a live broker client fetches the account from "api.alpaca.markets" and the host answers 429 then 200
    Then the live request is sent without waiting for the paper host's reset
    And the live caller receives the account after exactly 2 attempts

  @AC-18 @FR-9
  Scenario: Trading logs a throttled window
    Given a paper broker client, and the broker host answers "GET /v2/positions" with 429 and a reset 2 seconds in the future, then 200
    When positions are fetched
    Then one WARN log names host "paper-api.alpaca.markets" and the wait duration

  @AC-19 @FR-3
  Scenario: Retries are bounded when the caller has no deadline
    Given the data host answers every attempt with 429 and "X-RateLimit-Reset" 3600 seconds in the future
    When a bars request for "AAPL" is made on a context with no deadline
    Then the caller receives an error containing "rate limited" and "data.alpaca.markets" within 300 seconds

  @AC-20 @FR-1
  Scenario: Credentials are tracked independently on the same host
    Given broker client "A" with API key "KEY-A" recorded "X-RateLimit-Remaining: 0" with a reset 5 seconds in the future for "paper-api.alpaca.markets"
    And broker client "B" uses API key "KEY-B" on the same host
    When broker client "B" fetches the account
    Then the account request from "B" is sent without waiting for "A"'s reset

  @AC-21 @FR-9
  Scenario: A wait cut short by the deadline is recorded as throttle
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and a reset 10 seconds in the future for the data host
    When a latest-quote request for "NVDA" is made with a 2500 millisecond deadline
    Then "marketdata.vendor.requests" has one point with vendor "alpaca", op "quotes_latest", outcome "throttle"
    And no request for "NVDA" reaches the data host

  @AC-22 @FR-4
  Scenario: A zero static ceiling disables only the ceiling
    Given "marketdata.backfill.rate_limit_rps" is 0
    And the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and a reset 3 seconds in the future for the data host
    When a bars request for "AAPL" is made with a 30 second deadline
    Then the request reaches the data host no earlier than the reset time
