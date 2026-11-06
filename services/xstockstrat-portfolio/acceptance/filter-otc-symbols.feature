# Promoted from docs/roadmap/features/282-filter-otc-symbols/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-282 added.
# Durable business rules xstockstrat-portfolio guarantees for refusing unservable symbols on watchlist writes.

Feature: xstockstrat-portfolio — filter OTC symbols
  Watchlist write paths refuse unservable symbols per symbol and fail open when servability is unavailable.

  @AC-2 @FR-2 @feature-282
  Scenario: Adding an unservable symbol to a watchlist is refused per symbol
    Given watchlist "core" is empty and BOSSY is unservable and AAPL is servable
    When the owner adds BOSSY and AAPL to "core"
    Then AAPL is added
    And BOSSY is reported in refused_symbols with a reason
    And watchlist "core" contains only AAPL

  @AC-3 @FR-2 @feature-282
  Scenario: Creating a watchlist with an unservable symbol stores only the servable symbols
    Given CRTD is unservable and MSFT is servable
    When the owner creates watchlist "ideas" with symbols CRTD and MSFT
    Then watchlist "ideas" contains only MSFT
    And CRTD is reported in refused_symbols

  @AC-6 @FR-5 @feature-282
  Scenario: A failing servability call does not block a watchlist addition
    Given the GetSymbolServability call returns an error or exceeds portfolio.marketdata.servability_timeout_ms
    When the owner adds BOSSY to watchlist "core"
    Then BOSSY is added
    And portfolio logs a WARN that servability was unavailable

  @AC-8 @FR-2 @feature-282
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

  @AC-19 @FR-2 @feature-282
  Scenario: A name-only replace-all update drops a stored unservable symbol and reports it
    Given watchlist "core" stores CRTD and MSFT and CRTD is now unservable
    When the agent updates only the name of "core" by resubmitting every stored symbol
    Then MSFT stays and CRTD is dropped
    And CRTD is reported in refused_symbols

  @AC-25 @FR-2 @feature-282
  Scenario: The per-list cap counts accepted symbols only
    Given watchlist "core" holds 499 of a 500-symbol cap and BOSSY is unservable
    When the owner adds AAPL and BOSSY to "core"
    Then AAPL is added and BOSSY is refused
    And the request does not fail with InvalidArgument
