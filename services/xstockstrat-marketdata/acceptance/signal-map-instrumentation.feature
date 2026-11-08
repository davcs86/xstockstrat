# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (marketdata)

  @AC-12 @FR-4 @feature-294
  Scenario: Marketdata exposes the stream give-up and the age of the last message
    Given the Alpaca stream manager with an injected clock and max reconnects 5, whose first session reads a frame at time T and then drops
    And the next 4 sessions drop before the subscription ack
    When the gauge is collected at T+30s while the stream is still reconnecting, and again after the reconnect loop gives up
    Then the first collection of "marketdata.stream.last_message_age" reports 30 seconds
    And "marketdata.stream.reconnects" with result "reconnected" increases by 4 and with result "gave_up" by 1
    And the collection after the give-up reports no sample

  @AC-13 @FR-4 @feature-294
  Scenario: Vendor requests are counted by bounded outcome without leaking the FMP key
    Given an FMP request that returns HTTP 429 for URL "https://fmp.example/stable/profile?symbol=AAPL&apikey=SECRET123"
    When the request passes through the FMP chokepoint
    Then "marketdata.vendor.requests" with vendor "fmp", op "profile" and outcome "http_429" increases by 1
    And "marketdata.vendor.request.duration" with vendor "fmp" and op "profile" records 1 sample
    And no metric attribute, span attribute or log line contains "SECRET123"
    And no metric attribute contains "AAPL"
    And a throttle or cap exit counts outcome "throttle" or "cap" and records no duration sample

  @AC-14 @FR-4 @feature-294
  Scenario: A backfill of 5 symbols with 2 failures is counted per outcome and returns as before
    Given BackfillBars with timeframe "1d" for 5 symbols where 2 fail and 1 has zero bars
    When the RPC completes
    Then "marketdata.backfill.symbols" with kind "bars" increases by 2 for "written", 1 for "empty" and 2 for "failed"
    And the response still has FailedSymbols of length 2 and a nil error

  @AC-46 @FR-4 @feature-294
  Scenario: Warm-poller cache-insert failures are aggregated per cycle
    Given a warm-poller cycle over 25 symbols where cacheQuote fails for 8
    When the cycle completes
    Then exactly 1 WARN "warm poller: cache insert failures" is written with count 8 and at most 5 sample symbols
    And the per-symbol "warm poller: cache insert failed" lines are written at DEBUG, not WARN
    And the cycle still continues with the remaining symbols
