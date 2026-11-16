# Promoted from docs/roadmap/features/347-alpaca-adaptive-rate-limit/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-347` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — Alpaca REST client paces itself from rate-limit headers and bounds its loops

  @AC-1 @FR-1 @FR-2 @feature-347
  Scenario: An exhausted window holds the next request until the reset time
    Given the marketdata Alpaca client received a 200 from the data host with "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 3 seconds in the future
    When a bars request for "AAPL" is made with a 30 second deadline
    Then the request reaches the data host no earlier than the reset time
    And the caller receives the bars with no error

  @AC-2 @FR-1 @feature-347
  Scenario: Hosts are tracked independently
    Given the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 5 seconds in the future for the data host
    And it recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 150" and "X-RateLimit-Reset" 30 seconds in the future for the trading API host
    When an assets request is made to the trading API host
    Then the assets request is sent without waiting for the data host's reset

  @AC-4 @FR-3 @feature-347
  Scenario: A 429 is retried after the reset and the caller sees success
    Given the data host answers the first bars request for "MSFT" with 429 and "X-RateLimit-Reset" 2 seconds in the future
    And it answers the second attempt with 200 and 3 bars
    When a bars request for "MSFT" is made with a 30 second deadline
    Then the second attempt is sent no earlier than the reset time
    And the caller receives 3 bars with no error

  @AC-6 @FR-3 @feature-347
  Scenario: Retries stop at the caller's deadline
    Given the data host answers every attempt with 429 and "X-RateLimit-Reset" 10 seconds in the future
    When a latest-quote request for "NVDA" is made with a 2500 millisecond deadline
    Then the caller receives an error within 3 seconds
    And the error message contains "rate limited" and "data.alpaca.markets"

  @AC-7 @FR-4 @feature-347
  Scenario: The static ceiling still caps the rate when headers allow more
    Given "marketdata.backfill.rate_limit_rps" is 5
    And the data host reports "X-RateLimit-Limit: 10000", "X-RateLimit-Remaining: 10000" and "X-RateLimit-Reset" 60 seconds in the future on every response
    When 15 bars requests are issued at the same moment
    Then exactly 5 are sent at once
    And the 10th is sent no earlier than 1.0 second after the first, within a 100 millisecond tolerance
    And the 15th is sent no earlier than 2.0 seconds after the first, within a 100 millisecond tolerance

  @AC-8 @FR-5 @feature-347
  Scenario: Missing or malformed headers leave behavior unchanged
    Given the data host answers 200 with no "X-RateLimit-*" headers, then 200 with "X-RateLimit-Remaining: abc", then 200 with "X-RateLimit-Remaining: 0" and no "X-RateLimit-Reset", then 200 with no "X-RateLimit-*" headers
    When four bars requests are made one after another
    Then all four callers receive their bars with no error
    And no request is delayed beyond the static limiter

  @AC-9 @FR-6 @feature-347
  Scenario: The marketdata kill switch restores the previous behavior
    Given "marketdata.alpaca.adaptive_rate_limit_enabled" is false
    And the data host answers a bars request with 429 and "X-RateLimit-Reset" 2 seconds in the future
    When a bars request is made with a 30 second deadline
    Then exactly 1 attempt is sent
    And the caller receives an error starting with "alpaca bars 429" within 1 second

  @AC-11 @FR-7 @feature-347
  Scenario: Other vendors are not affected
    Given the FMP host answers a quote request with 429 and "X-RateLimit-Reset" 2 seconds in the future
    When a fundamentals fetch calls FMP
    Then exactly 1 FMP attempt is sent
    And the FMP daily budget reservation is refunded as before

  @AC-14 @FR-9 @feature-347
  Scenario: Throttling is visible in telemetry and logs
    Given the data host answers a bars request with 429 and a reset 2 seconds in the future, then 200
    When the bars request completes
    Then "marketdata.vendor.requests" has one point with vendor "alpaca", op "bars", outcome "http_429"
    And one point with vendor "alpaca", op "bars", outcome "ok"
    And one WARN log names the data host and the wait duration

  @AC-21 @FR-9 @feature-347
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

  @AC-22 @FR-4 @feature-347
  Scenario: A zero static ceiling disables only the ceiling
    Given "marketdata.backfill.rate_limit_rps" is 0
    And the marketdata Alpaca client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and a reset 3 seconds in the future for the data host
    When a bars request for "AAPL" is made with a 30 second deadline
    Then the request reaches the data host no earlier than the reset time

  @AC-32 @FR-11 @feature-347
  Scenario: Warm-quote writes keep the loop context after a late multi fetch
    Given warm symbols "AAA", "BBB" and "CCC" and a quote cache that rejects writes on a done context
    And "marketdata.stream.warm_interval_ms" is 200
    And the multi-symbol quote fetch returns quotes for all 3 symbols only once its context is done
    When the warm-quote poller runs one cycle
    Then quotes for "AAA", "BBB" and "CCC" are cached
    And one "loop tick ok" record is written for loop "warm_quote"
    And no per-symbol quote request is made
    And the multi-symbol quote fetch carried a deadline 200 milliseconds after the cycle began, within 50 milliseconds

  @AC-33 @FR-11 @feature-347
  Scenario: Bar ingest starts no fetch after the cycle deadline and never counts skipped symbols as empty
    Given warm symbols "AAA", "BBB" and "CCC" and "marketdata.stream.bar_ingest_backoff_ms" 21600000
    And the multi-symbol bars fetch fails
    And "marketdata.stream.bar_ingest_interval_ms" is 200
    And each per-symbol bars fetch returns an error only once its context is done, or after 2 seconds
    When the bar-ingest poller runs one cycle
    Then exactly 1 per-symbol bars request is made in the cycle
    And none of "AAA", "BBB" or "CCC" starts or extends a no-bars hold
