Feature: fix-marketdata-fundamentals-cache (bug fix)
  Regression guard for docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md:
  cap-0 disables FMP (D-50), quota counts ignore source (D-51), vendor cache ignores source (D-52),
  silent decode/enrichment drops (D-53), and a lifetime-cumulative Alpaca reconnect budget (D-19).

  @AC-1 @regression
  Scenario: An FMP daily cap of 0 means uncapped
    Given the fundamentals provider is "fmp" and "marketdata.fmp.daily_request_cap" is 0
    And the fundamentals cache has no row for "AAPL"
    When GetFundamentals is called for "AAPL"
    Then the FMP client makes the fetch
    And the response is fresh fundamentals for "AAPL", not ResourceExhausted
    And no quota WARNING alert is emitted

  @AC-2 @regression
  Scenario: Edgar snapshot rows do not consume the Finnhub quota
    Given the fundamentals provider is "finnhub" with "symbols_per_minute" 20 and "rate_window_seconds" 60
    And 20 fundamentals rows with source "edgar" were fetched in the last 60 seconds
    And no row with source "finnhub" was fetched in the last 60 seconds
    When GetFundamentals is called for uncached symbol "MSFT"
    Then the quota count is 0
    And the Finnhub client fetches "MSFT"

  @AC-3 @regression
  Scenario: The FMP boot budget seed counts only FMP rows
    Given 30 fundamentals rows fetched today with source "edgar" and 5 with source "fmp"
    When marketdata starts with provider "fmp"
    Then the FMP day budget is seeded with 5

  @AC-4 @regression
  Scenario: The vendor path does not serve an edgar cache row as vendor data
    Given the snapshot source is the vendor and the provider is "finnhub"
    And the cache holds an "AAPL" row with source "edgar" fetched 1 minute ago
    When GetFundamentals is called for "AAPL"
    Then the edgar row is treated as a cache miss
    And the Finnhub client fetches "AAPL"

  @AC-5 @regression
  Scenario: A failed FMP enrichment is not cached as a fresh complete row
    Given the provider is "fmp" in extended mode
    And the quote fetch for "AAPL" succeeds but fetchProfile returns ErrFMPDailyCapExceeded
    When GetFundamentals is called for "AAPL"
    Then a WARN is logged naming "AAPL" and the profile enrichment
    And the stored "AAPL" row is marked partial and is re-fetched on the next request after the quota resets, not after cache_ttl_hours

  @AC-6 @regression
  Scenario: An undecodable extra column is logged, not silently dropped
    Given the cache holds an "AAPL" row whose extra column is the bytes "\x7b22746f74616c5f64656274223a317d" (hex-garbled jsonb)
    When GetFundamentals is called for "AAPL"
    Then a WARN is logged naming "AAPL" and the extra decode error

  @AC-7 @regression
  Scenario: The Alpaca reconnect budget resets after a healthy session
    Given an Alpaca stream manager with MaxReconnects 3 and one active subscriber
    When the stream connects successfully and then drops, four times in a row
    Then the manager is still running and reconnects after the fourth drop

  @AC-8 @regression
  Scenario: Subscribers learn when the Alpaca stream gives up
    Given an Alpaca stream manager with MaxReconnects 3 and one active bar subscriber
    When three consecutive connection attempts fail without a healthy session
    Then the subscriber's bar channel is closed
