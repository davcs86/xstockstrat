# Promoted from docs/roadmap/features/148-mcp-watchlist-tools/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-148` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.
#
# NOTE: source scenario @AC-10 (tool-registry inventory + endpoint tool-count assertion) is a
# build-hygiene/meta check, not a durable behavioral rule, and is deliberately not promoted.

Feature: xstockstrat-agent — MCP watchlist tools
  What the agent guarantees for its list/read/curate watchlist tools: caller-ownership forwarding,
  verb dispatch, the read-modify-write merge that preserves stocks, and MANUAL-sourced curation.

  @AC-1 @FR-1 @FR-5 @feature-148
  Scenario: list_watchlists returns only the caller's own lists, paginated
    Given an authenticated caller "user-42" who owns two watchlists "Momentum" and "Dividends"
    When the agent calls list_watchlists with limit 1
    Then the PortfolioService.ListWatchlists RPC is called with x-user-id "user-42" and page_size 1
    And the tool returns a "watchlists" array and a "next_page_token" string

  @AC-2 @FR-2 @FR-5 @feature-148
  Scenario: get_watchlist returns a list's stocks including strategy bindings
    Given a watchlist "wl-momentum" owned by "user-42" containing bindings (NVDA, sma_crossover) and (AAPL, "")
    When the agent calls get_watchlist with watchlist_id "wl-momentum"
    Then the PortfolioService.GetWatchlist RPC is called with x-user-id "user-42" and watchlist_id "wl-momentum"
    And the tool returns a "watchlist" object whose bindings include symbol "NVDA" with strategy_id "sma_crossover"

  @AC-3 @FR-2 @feature-148
  Scenario: get_watchlist on a non-owned list surfaces the backend error
    Given the backend returns PERMISSION_DENIED for watchlist_id "wl-someone-else"
    When the agent calls get_watchlist with watchlist_id "wl-someone-else"
    Then the tool raises an error whose message conveys the permission denial

  @AC-4 @FR-3 @FR-5 @feature-148
  Scenario: manage_watchlist create makes a new list owned by the caller
    Given an authenticated caller "user-42"
    When the agent calls manage_watchlist with operation "create", name "Breakouts", symbols ["TSLA","AMD"]
    Then the PortfolioService.CreateWatchlist RPC is called with x-user-id "user-42", name "Breakouts", and two symbols
    And no user_id is sent in the request body
    And the tool returns the created "watchlist" with a watchlist_id

  @AC-5 @FR-3 @feature-148
  Scenario: manage_watchlist update of only the name does not wipe existing symbols
    Given a watchlist "wl-momentum" owned by "user-42" containing NVDA and AAPL
    When the agent calls manage_watchlist with operation "update", watchlist_id "wl-momentum", name "Momentum 2.0"
    Then the UpdateWatchlist request carries the new name
    And the request does not carry an empty symbols/bindings set that would replace the existing NVDA and AAPL entries

  @AC-6 @FR-3 @feature-148
  Scenario: manage_watchlist delete of the system-managed signals list is refused
    Given the backend returns FAILED_PRECONDITION for deleting the system-managed signals watchlist "wl-signals"
    When the agent calls manage_watchlist with operation "delete", watchlist_id "wl-signals"
    Then the tool raises an error and no watchlist is deleted

  @AC-7 @FR-4 @FR-5 @feature-148
  Scenario: manage_watchlist_symbols add records MANUAL-sourced bindings
    Given a watchlist "wl-momentum" owned by "user-42"
    When the agent calls manage_watchlist_symbols with operation "add", watchlist_id "wl-momentum", bindings [(GOOG, sma_crossover)]
    Then the AddWatchlistSymbols RPC is called with x-user-id "user-42" and a binding for GOOG with source WATCHLIST_ENTRY_SOURCE_MANUAL
    And the tool returns the updated watchlist including GOOG

  @AC-8 @FR-4 @feature-148
  Scenario: manage_watchlist_symbols remove drops symbols from a list
    Given a watchlist "wl-momentum" owned by "user-42" containing NVDA and AAPL
    When the agent calls manage_watchlist_symbols with operation "remove", watchlist_id "wl-momentum", symbols ["AAPL"]
    Then the RemoveWatchlistSymbols RPC is called with x-user-id "user-42" and symbols ["AAPL"]
    And the tool returns the updated watchlist no longer containing AAPL

  @AC-9 @FR-4 @feature-148
  Scenario: an unknown operation verb is rejected before any RPC
    Given an authenticated caller "user-42"
    When the agent calls manage_watchlist_symbols with operation "replace"
    Then the tool raises a value error naming the allowed operations
    And no PortfolioService RPC is called
