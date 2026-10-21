Feature: fix-marketdata-fundamentals-cache (bug fix)
  Regression guard for docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md:
  cap-0 disables FMP (D-50), quota counts ignore source (D-51), vendor cache ignores source (D-52),
  silent decode/enrichment drops (D-53), and a lifetime-cumulative Alpaca reconnect budget (D-19).

  @AC-1 @FR-1 @regression
  Scenario: An FMP daily cap of 0 means uncapped
    Given "marketdata.fundamentals.provider" is "fmp" and "marketdata.fmp.daily_request_cap" is 0
    And the fundamentals cache has no row for "AAPL"
    When GetFundamentals is called for "AAPL"
    Then the FMP client makes the fetch
    And the response is fresh fundamentals for "AAPL", not ResourceExhausted
    And no quota WARNING alert is emitted

  @AC-9 @FR-1 @regression
  Scenario: An FMP daily cap of 0 means uncapped on the multi-symbol path
    Given "marketdata.fundamentals.provider" is "fmp" and "marketdata.fmp.daily_request_cap" is 0
    And the fundamentals cache has no row for "AAPL" or "MSFT"
    When GetFundamentalsMulti is called for "AAPL" and "MSFT"
    Then the FMP client makes the fetch
    And the response holds fresh fundamentals for "AAPL" and "MSFT", not ResourceExhausted
    And no quota WARNING alert is emitted

  @AC-2 @FR-2 @regression
  Scenario: Edgar snapshot rows do not consume the Finnhub quota
    Given "marketdata.fundamentals.provider" is "finnhub" with "marketdata.finnhub.symbols_per_minute" 20 and "marketdata.finnhub.rate_window_seconds" 60
    And 20 fundamentals rows with source "edgar" were fetched in the last 60 seconds
    And no row with source "finnhub" was fetched in the last 60 seconds
    When GetFundamentals is called for uncached symbol "MSFT"
    Then the Finnhub client fetches "MSFT"
    And the response is fresh fundamentals for "MSFT", not ResourceExhausted
    And no quota WARNING alert is emitted

  @AC-3 @FR-2 @regression
  Scenario: The FMP boot budget seed counts only FMP rows
    Given "marketdata.fundamentals.provider" is "fmp" and "marketdata.fmp.daily_request_cap" is 7
    And 30 fundamentals rows fetched today with source "edgar" and 5 with source "fmp"
    And marketdata has started
    When GetFundamentals is called for uncached symbol "MSFT"
    Then the FMP client fetches "MSFT"
    And the response is fresh fundamentals for "MSFT", not ResourceExhausted

  @AC-4 @FR-3 @regression
  Scenario: The vendor path does not serve an edgar cache row as vendor data
    Given "marketdata.fundamentals.snapshot_source" is "vendor" and "marketdata.fundamentals.provider" is "finnhub"
    And the cache holds an "AAPL" row with source "edgar" fetched 1 minute ago
    When GetFundamentals is called for "AAPL"
    Then the Finnhub client fetches "AAPL"
    And the response carries the Finnhub values for "AAPL", not the edgar row's values

  @AC-5 @FR-4 @regression
  Scenario: A failed FMP enrichment is not cached as a fresh complete row
    Given "marketdata.fundamentals.provider" is "fmp" and "marketdata.fmp.metrics" is "core,extended"
    And the quote fetch for "AAPL" succeeds but the profile fetch returns ErrFMPDailyCapExceeded
    When GetFundamentals is called for "AAPL"
    Then a WARN is logged naming "AAPL" and the profile enrichment
    And the response's missing_metrics lists "beta" and "sector", the metrics the profile call supplies
    When the FMP daily quota resets and GetFundamentals is called for "AAPL" again, within "marketdata.fmp.cache_ttl_hours"
    Then the FMP client makes the profile fetch for "AAPL"

  @AC-6 @FR-4 @regression
  Scenario: An undecodable extra column is logged, not silently dropped
    Given the cache holds an "AAPL" row whose extra column is the bytes "\x7b22746f74616c5f64656274223a317d" (hex-garbled jsonb)
    When GetFundamentals is called for "AAPL"
    Then a WARN is logged naming "AAPL" and the extra decode error

  @AC-7 @FR-5 @regression
  Scenario: The Alpaca reconnect budget resets after a healthy session
    Given an Alpaca stream manager with MaxReconnects 3 and one active subscriber
    When the stream connects successfully and then drops, four times in a row
    Then the manager is still running and reconnects after the fourth drop

  @AC-8 @FR-5 @regression
  Scenario: Subscribers learn when the Alpaca stream gives up
    Given an Alpaca stream manager with MaxReconnects 3 and one active bar subscriber
    When three consecutive connection attempts fail without a healthy session
    Then the subscriber's receive on its bar channel reports the channel closed
    And an ERROR is logged naming the exhausted reconnect budget
