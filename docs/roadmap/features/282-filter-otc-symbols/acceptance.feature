Feature: filter-otc-symbols
  As a trader or operator, I want OTC symbols kept out of watchlists and the bar-ingestion warm set, so that symbols the platform cannot serve stop generating failing GetBars calls, repeated Alpaca fetches and no-bars warnings.

  @AC-1 @FR-1
  Scenario: Marketdata classifies symbols from Alpaca asset exchange
    Given Alpaca lists BOSSY with exchange "OTC" and AAPL with exchange "NASDAQ"
    When another service asks marketdata whether BOSSY and AAPL are OTC
    Then BOSSY is reported as OTC
    And AAPL is reported as not OTC

  @AC-2 @FR-2
  Scenario: Adding an OTC symbol to a watchlist is refused per symbol
    Given watchlist "core" is empty and BOSSY is OTC and AAPL is not
    When the owner adds BOSSY and AAPL to "core"
    Then AAPL is added
    And BOSSY is reported as refused with a reason naming over-the-counter symbols
    And watchlist "core" contains only AAPL

  @AC-3 @FR-2
  Scenario: Creating a watchlist with an OTC symbol stores only the supported symbols
    Given CRTD is OTC and MSFT is not
    When the owner creates watchlist "ideas" with symbols CRTD and MSFT
    Then watchlist "ideas" contains only MSFT
    And CRTD is reported as refused

  @AC-4 @FR-3
  Scenario: GetBars for an OTC symbol does not trigger a live fetch or warm the symbol
    Given BOSSY is OTC and has no stored 1d bars
    When GetBars is called for BOSSY
    Then the response contains 0 bars
    And marketdata makes 0 live Alpaca fetches for BOSSY
    And BOSSY is not in the warm set the bar ingester reads

  @AC-5 @FR-4
  Scenario: A signal for an OTC symbol does not add it to the signal watchlist
    Given FORL is OTC
    When a signal for FORL is ingested and EnsureSignalWatchlist runs for its owner
    Then no watchlist binding is created for FORL

  @AC-6 @FR-5
  Scenario: Unavailable asset metadata does not block a watchlist addition
    Given the marketdata asset lookup returns an error
    When the owner adds BOSSY to watchlist "core"
    Then BOSSY is added
    And a WARN is logged that OTC classification was unavailable

  @AC-7 @FR-1 @FR-2 @FR-3
  Scenario: Delisted or non-tradable symbols are blocked like OTC symbols
    Given Alpaca reports DNB as inactive and non-tradable
    When DNB is added to a watchlist and GetBars is called for DNB
    Then DNB is reported as refused with a reason
    And marketdata makes 0 live Alpaca fetches for DNB
    And DNB is not in the warm set the bar ingester reads
