# Promoted from docs/roadmap/features/347-alpaca-adaptive-rate-limit/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-347` tag.
# Durable business rules xstockstrat-trading already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-trading — Alpaca broker client retries a 429 safely and rate-limited order mutations stay definite

  @AC-10 @FR-6 @feature-347
  Scenario: The trading kill switch restores the previous behavior
    Given "trading.broker.adaptive_rate_limit_enabled" is false
    And the broker host answers "GET /v2/account" with 429
    When the account is fetched
    Then exactly 1 attempt is sent
    And the caller receives an error containing "status 429"

  @AC-12 @FR-8 @feature-347
  Scenario: A rate-limited order submit creates exactly one order
    Given the broker host answers the first "POST /v2/orders" with 429 and a reset 1 second in the future
    And it answers the second attempt with 200 and broker order id "b-1"
    When a MARKET order for 10 shares of "AAPL" with client_order_id "c-42" is submitted
    Then both attempts carry client_order_id "c-42" and an identical JSON body
    And the caller receives broker order id "b-1"
    And exactly one order intent is finalized for "c-42"
    And the same flow with a LIMIT order for 10 shares of "AAPL" at 150.00 also yields exactly one order

  @AC-15 @FR-8 @feature-347
  Scenario: A rate-limited cancel takes effect exactly once
    Given the broker host answers the first "DELETE /v2/orders/b-1" with 429 and a reset 1 second in the future
    And it answers the second attempt with 204
    When order "b-1" is canceled
    Then exactly 2 DELETE attempts are sent for "b-1"
    And the caller receives no error

  @AC-16 @FR-8 @feature-347
  Scenario: A rate-limited replace is retried with the same body
    Given the broker host answers the first "PATCH /v2/orders/b-1" with 429 and a reset 1 second in the future
    And it answers the second attempt with 200 and broker order id "b-2"
    When order "b-1" is replaced with quantity 7
    Then both PATCH attempts carry an identical JSON body with qty "7"
    And the caller receives broker order id "b-2"

  @AC-17 @FR-10 @feature-347
  Scenario: Paper and live hosts are handled the same and tracked separately
    Given a paper broker client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 5 seconds in the future for "paper-api.alpaca.markets"
    When a live broker client fetches the account from "api.alpaca.markets" and the host answers 429 then 200
    Then the live request is sent without waiting for the paper host's reset
    And the live caller receives the account after exactly 2 attempts

  @AC-18 @FR-9 @feature-347
  Scenario: Trading logs a throttled window
    Given a paper broker client, and the broker host answers "GET /v2/positions" with 429 and a reset 2 seconds in the future, then 200
    When positions are fetched
    Then one WARN log names host "paper-api.alpaca.markets" and the wait duration

  @AC-20 @FR-1 @feature-347
  Scenario: Credentials are tracked independently on the same host
    Given broker client "A" with API key "KEY-A" recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 5 seconds in the future for "paper-api.alpaca.markets"
    And broker client "B" uses API key "KEY-B" on the same host
    When broker client "B" fetches the account
    Then the account request from "B" is sent without waiting for "A"'s reset

  @AC-23 @FR-2 @feature-347
  Scenario: A trading read that cannot outwait a hold is refused without a request
    Given a paper broker client recorded "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 10 seconds in the future for "paper-api.alpaca.markets"
    And "trading.broker.timeout_ms" is 5000
    When positions are fetched on a context with a 5 second deadline
    Then no request reaches "paper-api.alpaca.markets"
    And within 100 milliseconds the caller receives an error that is broker.ErrRateLimited and contains "rate limited" and "paper-api.alpaca.markets"

  @AC-25 @FR-8 @feature-347
  Scenario: A rate-limited submit is not abandoned when the caller cancels
    Given the broker host answers the first "POST /v2/orders" with 429 and no "X-RateLimit-Reset" header
    And it answers the second attempt with 200 and broker order id "b-7"
    When a MARKET order for 10 shares of "AAPL" is submitted and the caller cancels its request 500 milliseconds later
    Then 2 "POST /v2/orders" attempts are sent with the same client_order_id
    And the order is persisted with broker order id "b-7" and is not REJECTED
    And its order intent is finalized Completed

  @AC-26 @FR-8 @feature-347
  Scenario: A submit whose caller deadline leaves no room for a retry is rejected as rate limited
    Given "trading.broker.timeout_ms" is 5000
    And the broker host answers the first "POST /v2/orders" with 429 and "X-RateLimit-Reset" 2 seconds in the future
    When a MARKET order for 10 shares of "AAPL" is submitted on a context with a 3 second deadline
    Then exactly 1 "POST /v2/orders" attempt is sent
    And the caller receives an error containing "rate limited"
    And the order is REJECTED, an "order.broker_rejected" event is emitted and its order intent is finalized Rejected

  @AC-27 @FR-8 @feature-347
  Scenario: An attempt that times out inside a retry stays uncertain
    Given "trading.broker.timeout_ms" is 1000
    And the broker host answers the first "POST /v2/orders" with 429 and no "X-RateLimit-Reset" header
    And it sends no response to the second attempt for 3 seconds
    When a MARKET order for 10 shares of "AAPL" is submitted
    Then 2 "POST /v2/orders" attempts are sent
    And the order is not REJECTED, its order intent stays PENDING and an "order.broker_call_uncertain" event is emitted

  @AC-28 @FR-8 @feature-347
  Scenario: A rate-limited emergency flatten halts the account first and keeps retrying
    Given account "acct-1" holds 10 shares of "AAPL" whose bracket is past its protection deadline
    And "trading.order.max_retries" is 3
    And the broker host answers the first "POST /v2/orders" with 429, "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 50 seconds in the future
    When the emergency flatten runs for the position
    Then account "acct-1" is halted before the second flatten submit is made
    And 4 flatten orders are recorded REJECTED, and the 4 flatten submits carried 4 distinct client order ids
    And exactly 1 "POST /v2/orders" reaches the broker host
    And account "acct-1" is still halted afterwards

  @AC-29 @FR-8 @feature-347
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

  @AC-30 @FR-8 @feature-347
  Scenario: A rate-limited cancel whose intent was already reclaimed reports the intent as unknown
    Given order "ord-1" of user "user-1" is NEW with broker order id "b-1" on an Alpaca account
    And while the cancel of "b-1" is at the broker, the cancel intent row is moved to UNKNOWN, as the sweeper does, and the broker then refuses the cancel with a rate-limit error
    When "user-1" cancels "ord-1"
    Then the caller receives Unavailable with a message containing "could not be released; verify with the broker before retrying"
    And "ord-1" is still NEW with intent state UNKNOWN
    And an identical cancel is answered FailedPrecondition containing "outcome is unknown" without a broker call

  @AC-31 @FR-8 @feature-347
  Scenario: A rate-limited replace leaves the order unchanged and an identical retry really retries
    Given order "ord-1" of user "user-1" is NEW for 10 shares with broker order id "b-1" on an Alpaca account
    And the broker refuses the first replace of "b-1" with a rate-limit error and accepts the second
    When "user-1" replaces "ord-1" with quantity 7
    Then the caller receives Unavailable with a message containing "refused by the broker rate limit; the order is unchanged"
    And "ord-1" still has quantity 10 and no replace intent row remains
    When "user-1" sends the identical replace again
    Then a second replace of "b-1" reaches the broker and "ord-1" has quantity 7

  @AC-34 @FR-11 @feature-347
  Scenario: The fill poller does not stall on a throttled Alpaca account
    Given an Alpaca paper account with 3 open orders and "trading.broker.timeout_ms" 5000
    And the broker host answered its "GET /v2/account" with 200, "X-RateLimit-Limit: 200", "X-RateLimit-Remaining: 0" and "X-RateLimit-Reset" 10 seconds in the future
    When the fill poller runs one tick
    Then no "GET /v2/orders/{id}" request reaches the broker host
    And the tick ends within 100 milliseconds with 3 logged GetOrder failures
    And no "loop tick ok" record is written for loop "fill_poller"

  @AC-35 @FR-11 @FR-8 @feature-347
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

  @AC-36 @FR-11 @feature-347
  Scenario: The not-cancelable re-read is bounded by one broker timeout
    Given order "ord-1" of user "user-1" is NEW with broker order id "b-1" on an Alpaca paper account
    And the broker host answers "DELETE /v2/orders/b-1" with 422
    And it answers "GET /v2/orders/b-1" with 429 carrying only "X-RateLimit-Reset" 10 seconds in the future
    When "user-1" cancels "ord-1"
    Then exactly 1 "GET /v2/orders/b-1" is sent
    And within 1 second the caller receives Unavailable containing "could not be read"
    And "ord-1" has intent state UNKNOWN and is not CANCELED
