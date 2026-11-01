Feature: filter-otc-symbols
  As a trader or operator, I want OTC, delisted and non-tradable symbols kept out of watchlists and the bar-ingestion warm set, so that symbols the platform cannot serve stop generating failing GetBars calls, repeated Alpaca fetches and no-bars warnings.

  @AC-1 @FR-1
  Scenario: Marketdata classifies symbols against its loaded asset set
    Given the asset set is loaded and lists AAPL with exchange "NASDAQ" and BOSSY with exchange "OTC" but not DNB
    When another service calls GetSymbolServability for AAPL, BOSSY and DNB
    Then AAPL is servable
    And BOSSY is unservable with a reason
    And DNB is unservable with a reason
    And asset_set_loaded is true

  @AC-2 @FR-2
  Scenario: Adding an unservable symbol to a watchlist is refused per symbol
    Given watchlist "core" is empty and BOSSY is unservable and AAPL is servable
    When the owner adds BOSSY and AAPL to "core"
    Then AAPL is added
    And BOSSY is reported in refused_symbols with a reason
    And watchlist "core" contains only AAPL

  @AC-3 @FR-2
  Scenario: Creating a watchlist with an unservable symbol stores only the servable symbols
    Given CRTD is unservable and MSFT is servable
    When the owner creates watchlist "ideas" with symbols CRTD and MSFT
    Then watchlist "ideas" contains only MSFT
    And CRTD is reported in refused_symbols

  @AC-4 @FR-3
  Scenario: GetBars for an unservable symbol does not trigger a live fetch or warm the symbol
    Given BOSSY is unservable and has no stored 1d bars
    When GetBars is called for BOSSY
    Then the response contains 0 bars
    And marketdata makes 0 live Alpaca fetches for BOSSY
    And GetBars does not add BOSSY to the warm set

  @AC-5 @FR-4
  Scenario: A watchlist-direction signal for an unservable symbol is not added
    Given FORL is unservable
    When a signal for FORL is ingested with direction "watchlist" and the agent adds it to the signal watchlist with AddWatchlistSymbols
    Then no watchlist binding is created for FORL
    And the ingest still succeeds
    And the ingest_signal result carries FORL in watchlist_refused

  @AC-6 @FR-5
  Scenario: A failing servability call does not block a watchlist addition
    Given the GetSymbolServability call returns an error or exceeds portfolio.marketdata.servability_timeout_ms
    When the owner adds BOSSY to watchlist "core"
    Then BOSSY is added
    And portfolio logs a WARN that servability was unavailable

  @AC-7 @FR-1 @FR-2 @FR-3
  Scenario: Delisted or non-tradable symbols are blocked like OTC symbols
    Given DNB is absent from the loaded active and tradable asset set
    When DNB is added to a watchlist and GetBars is called for DNB
    Then DNB is reported in refused_symbols with a reason
    And marketdata makes 0 live Alpaca fetches for DNB
    And GetBars does not add DNB to the warm set

  @AC-8 @FR-2
  Scenario Outline: Every watchlist write path that inserts symbols refuses unservable symbols
    Given CRTD is unservable and MSFT is servable
    When <path> is called with symbols CRTD and MSFT
    Then CRTD is reported in refused_symbols with a reason
    And MSFT is stored

    Examples:
      | path                                    |
      | CreateWatchlist with symbols            |
      | UpdateWatchlist replace-all with bindings |
      | AddWatchlistSymbols with bindings       |

  @AC-9 @FR-5
  Scenario: An asset set that has never loaded does not block GetBars or warming
    Given marketdata has not yet loaded the asset set
    When GetBars is called for BOSSY
    Then marketdata attempts the live fetch as it does today
    And marketdata logs one WARN on entering the unloaded state, not one per call

  @AC-10 @FR-5
  Scenario: A failed refresh keeps the last good asset set
    Given the asset set loaded successfully and lists AAPL but not BOSSY
    When a later refresh returns an error
    Then BOSSY is still unservable and AAPL is still servable
    And the next refresh is retried with backoff

  @AC-11 @FR-5
  Scenario: A shrunken or empty refresh is rejected
    Given the asset set loaded successfully with 10000 symbols
    When a refresh returns 4000 symbols
    Then the refresh is rejected, the last good set is kept and a WARN is logged
    And an empty refresh is rejected the same way

  @AC-12 @FR-3
  Scenario: Strict BatchGetBars omits unservable cold symbols without a live fetch
    Given the asset set is loaded and lists AAPL but not BOSSY
    And marketdata.ohlcv holds 1d bars for AAPL and none for BOSSY
    And the live bar fetch returns an error
    When BatchGetBars is called for AAPL and BOSSY with allow_partial false
    Then the call succeeds with bars for AAPL only
    And marketdata makes 0 live fetches
    And BOSSY is omitted from the response

  @AC-13 @FR-3
  Scenario: BatchGetLatestPrice does not warm or trade-fetch unservable symbols
    Given the asset set is loaded and lists AAPL but not BOSSY
    And BOSSY has a stored previous close
    When BatchGetLatestPrice is called for AAPL and BOSSY
    Then AAPL is returned with its live price
    And BOSSY is returned with prev_close only and last_price unset
    And BOSSY is not added to the warm set and no trade is fetched for it
    And a symbol without a stored previous close is omitted

  @AC-14 @FR-3
  Scenario: Partial BatchGetBars still fetches servable cold symbols within the deadline
    Given the asset set is loaded and lists AAPL and ZZZZ but not BOSSY
    And the live bar fetch for ZZZZ never answers and the caller deadline is 1000ms
    When BatchGetBars is called for AAPL, ZZZZ and BOSSY with allow_partial true
    Then the call returns within the deadline with the stored bars for AAPL
    And ZZZZ was requested from the live fetch and BOSSY was not

  @AC-15 @FR-3
  Scenario: The first successful load removes unservable symbols warmed while unloaded
    Given the asset set has not loaded and BOSSY and AAPL were warmed
    When the first load succeeds and lists AAPL but not BOSSY
    Then BOSSY is removed from the warm set and AAPL stays
    And a later refresh that stops listing AAPL does not remove it from the warm set

  @AC-16 @FR-3
  Scenario: Quote and price paths are not gated
    Given BOSSY is unservable
    When GetLatestQuotes, GetLatestQuote and GetLatestPrice are called for BOSSY
    Then BOSSY is added to the warm set by each of them
    And their live fetch behaviour is unchanged

  @AC-17 @FR-3
  Scenario: A held offline unservable symbol stays valued and warm across later refreshes
    Given an offline account holds FORL, which is unservable and has a stored 1d close
    When portfolio values the account and a later asset-set refresh runs
    Then portfolio requests FORL through GetLatestQuotes and values it from the quote or stored close
    And FORL stays in the warm set after the later refresh

  @AC-18 @FR-2
  Scenario: Agent tools return the refused symbols and reasons
    Given CRTD is unservable and MSFT is servable
    When the agent calls manage_watchlist_symbols add and manage_watchlist create with CRTD and MSFT
    Then each result carries the stored watchlist
    And each result carries CRTD in refused with the reason name "UNSERVABLE_REASON_OTC" or "UNSERVABLE_REASON_NOT_TRADABLE"

  @AC-19 @FR-2
  Scenario: A name-only replace-all update drops a stored unservable symbol and reports it
    Given watchlist "core" stores CRTD and MSFT and CRTD is now unservable
    When the agent updates only the name of "core" by resubmitting every stored symbol
    Then MSFT stays and CRTD is dropped
    And CRTD is reported in refused_symbols

  @AC-20 @FR-2
  Scenario: The UI add controls show each refused symbol with its reason
    Given CRTD is unservable and MSFT is servable
    When the user adds CRTD and MSFT in the watchlist detail, or uses screener save-as or Add top N
    Then MSFT is added
    And a notice lists CRTD with its reason

  @AC-21 @FR-2
  Scenario: Renaming a watchlist in the UI never drops or refuses stored symbols
    Given watchlist "core" stores CRTD and MSFT and CRTD is unservable
    When the user renames "core" in the UI
    Then the update is sent with the field mask "name"
    And both symbols stay stored and nothing is refused

  @AC-22 @FR-1 @FR-5
  Scenario: An oversized servability request is rejected and portfolio lets the write through
    Given a GetSymbolServability request with 1001 symbols
    Then marketdata rejects it with InvalidArgument
    And portfolio, on any error from that call, adds the symbols and logs a WARN

  @AC-23 @FR-1
  Scenario: Symbols are normalized before classification
    Given the asset set lists BOSSY
    When GetSymbolServability and GetBars are called with " bossy "
    Then the symbol is classified as BOSSY in both calls

  @AC-24 @FR-5
  Scenario: The refresh interval is clamped on read
    Given marketdata.assets.refresh_interval_hours is 0, 48 or unset
    Then 0 pauses refreshes and keeps the current set
    And 48 is read as 24
    And unset is read as 6

  @AC-25 @FR-2
  Scenario: The per-list cap counts accepted symbols only
    Given watchlist "core" holds 499 of a 500-symbol cap and BOSSY is unservable
    When the owner adds AAPL and BOSSY to "core"
    Then AAPL is added and BOSSY is refused
    And the request does not fail with InvalidArgument

  @AC-26 @FR-3
  Scenario: A held symbol pruned by the first load is re-warmed by the next quote read
    Given FORL was warmed by GetLatestQuotes before the first asset-set load and is unservable
    When the first load succeeds
    Then FORL is removed from the warm set
    And the next GetLatestQuotes call for FORL adds it back
