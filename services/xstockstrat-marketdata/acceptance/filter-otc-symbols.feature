# Promoted from docs/roadmap/features/282-filter-otc-symbols/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-282 added.
# Durable business rules xstockstrat-marketdata guarantees for symbol servability, the asset set and the warm set.

Feature: xstockstrat-marketdata — filter OTC symbols
  OTC, delisted and non-tradable symbols are classified as unservable and generate no live fetches or warming.

  @AC-1 @FR-1 @feature-282
  Scenario: Marketdata classifies symbols against its loaded asset set
    Given the asset set is loaded and lists AAPL with exchange "NASDAQ" and BOSSY with exchange "OTC" but not DNB
    When another service calls GetSymbolServability for AAPL, BOSSY and DNB
    Then AAPL is servable
    And BOSSY is unservable with a reason
    And DNB is unservable with a reason
    And asset_set_loaded is true

  @AC-4 @FR-3 @feature-282
  Scenario: GetBars for an unservable symbol does not trigger a live fetch or warm the symbol
    Given BOSSY is unservable and has no stored 1d bars
    When GetBars is called for BOSSY
    Then the response contains 0 bars
    And marketdata makes 0 live Alpaca fetches for BOSSY
    And GetBars does not add BOSSY to the warm set

  @AC-9 @FR-5 @feature-282
  Scenario: An asset set that has never loaded does not block GetBars or warming
    Given marketdata has not yet loaded the asset set
    When GetBars is called for BOSSY
    Then marketdata attempts the live fetch as it does today
    And marketdata logs one WARN on entering the unloaded state, not one per call

  @AC-10 @FR-5 @feature-282
  Scenario: A failed refresh keeps the last good asset set
    Given the asset set loaded successfully and lists AAPL but not BOSSY
    When a later refresh returns an error
    Then BOSSY is still unservable and AAPL is still servable
    And the next refresh is retried with backoff

  @AC-11 @FR-5 @feature-282
  Scenario: A shrunken or empty refresh is rejected
    Given the asset set loaded successfully with 10000 symbols
    When a refresh returns 4000 symbols
    Then the refresh is rejected, the last good set is kept and a WARN is logged
    And an empty refresh is rejected the same way

  @AC-12 @FR-3 @feature-282
  Scenario: Strict BatchGetBars omits unservable cold symbols without a live fetch
    Given the asset set is loaded and lists AAPL but not BOSSY
    And marketdata.ohlcv holds 1d bars for AAPL and none for BOSSY
    And the live bar fetch returns an error
    When BatchGetBars is called for AAPL and BOSSY with allow_partial false
    Then the call succeeds with bars for AAPL only
    And marketdata makes 0 live fetches
    And BOSSY is omitted from the response

  @AC-13 @FR-3 @feature-282
  Scenario: BatchGetLatestPrice does not warm or trade-fetch unservable symbols
    Given the asset set is loaded and lists AAPL but not BOSSY
    And BOSSY has a stored previous close
    When BatchGetLatestPrice is called for AAPL and BOSSY
    Then AAPL is returned with its live price
    And BOSSY is returned with prev_close only and last_price unset
    And BOSSY is not added to the warm set and no trade is fetched for it
    And a symbol without a stored previous close is omitted

  @AC-14 @FR-3 @feature-282
  Scenario: Partial BatchGetBars still fetches servable cold symbols within the deadline
    Given the asset set is loaded and lists AAPL and ZZZZ but not BOSSY
    And the live bar fetch for ZZZZ never answers and the caller deadline is 1000ms
    When BatchGetBars is called for AAPL, ZZZZ and BOSSY with allow_partial true
    Then the call returns within the deadline with the stored bars for AAPL
    And ZZZZ was requested from the live fetch and BOSSY was not

  @AC-15 @FR-3 @feature-282
  Scenario: The first successful load removes unservable symbols warmed while unloaded
    Given the asset set has not loaded and BOSSY and AAPL were warmed
    When the first load succeeds and lists AAPL but not BOSSY
    Then BOSSY is removed from the warm set and AAPL stays
    And a later refresh that stops listing AAPL does not remove it from the warm set

  @AC-16 @FR-3 @feature-282
  Scenario: Quote and price paths are not gated
    Given BOSSY is unservable
    When GetLatestQuotes, GetLatestQuote and GetLatestPrice are called for BOSSY
    Then BOSSY is added to the warm set by each of them
    And their live fetch behaviour is unchanged

  @AC-23 @FR-1 @feature-282
  Scenario: Symbols are normalized before classification
    Given the asset set lists BOSSY
    When GetSymbolServability and GetBars are called with " bossy "
    Then the symbol is classified as BOSSY in both calls

  @AC-24 @FR-1 @FR-5 @feature-282
  Scenario: The refresh interval is clamped on read
    Given marketdata.assets.refresh_interval_hours is 0, 48 or unset
    Then 0 pauses refreshes and keeps the current set
    And 48 is read as 24
    And unset is read as 6

  @AC-26 @FR-3 @feature-282
  Scenario: A held symbol pruned by the first load is re-warmed by the next quote read
    Given FORL was warmed by GetLatestQuotes before the first asset-set load and is unservable
    When the first load succeeds
    Then FORL is removed from the warm set
    And the next GetLatestQuotes call for FORL adds it back
