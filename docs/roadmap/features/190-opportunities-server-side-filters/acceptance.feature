Feature: opportunities-server-side-filters
  As a trader triaging the ranked opportunity queue, I want the min-conviction floor, source
  and action filters, and the sort evaluated server-side across my whole queue, so that what I
  see and page through is authoritative rather than a client-side approximation over loaded pages.

  @AC-1 @FR-1
  Scenario: Min-conviction floor is applied by the server, not the client
    Given the user's materialized queue has an ENTER row for AAPL with conviction 0.80 and an
      ENTER row for MSFT with conviction 0.30, both valid and non-muted
    When the UI requests ListOpportunities with min_conviction 0.50
    Then the response opportunities include AAPL and exclude MSFT
    And the request sent on the wire carries min_conviction 0.50 (not a hard-coded 0.0)

  @AC-2 @FR-1
  Scenario: A muted row survives a raised min-conviction floor
    Given the user's queue has a muted (provenance contains "denied") row for TSLA with conviction 0.0
    When the UI requests ListOpportunities with min_conviction 0.50
    Then the response opportunities still include the muted TSLA row

  @AC-3 @FR-1
  Scenario: A data-unavailable row survives a raised min-conviction floor
    Given the user's queue has a data-unavailable (provenance contains "unavailable") row for NVDA
      with conviction 0.0
    When the UI requests ListOpportunities with min_conviction 0.50
    Then the response opportunities still include the data-unavailable NVDA row

  @AC-4 @FR-2
  Scenario: Source filter returns only matching sources
    Given the user's queue has a row whose primary source is "live_strategy" and a row whose
      primary source is "sec_edgar_8k"
    When the UI requests ListOpportunities with sources = ["live_strategy"]
    Then every returned opportunity has source "live_strategy"
    And no returned opportunity has source "sec_edgar_8k"

  @AC-5 @FR-2
  Scenario: Empty source filter returns all sources
    Given the user's queue has rows from sources "live_strategy" and "sec_edgar_8k"
    When the UI requests ListOpportunities with sources = []
    Then returned opportunities include both "live_strategy" and "sec_edgar_8k" rows

  @AC-6 @FR-3
  Scenario: Action filter returns only the selected action
    Given the user's queue has an ENTER row for AHR and a REDUCE row for AMAT
    When the UI requests ListOpportunities with action_filter = OPPORTUNITY_ACTION_TAG_REDUCE
    Then returned opportunities include the AMAT REDUCE row
    And returned opportunities exclude the AHR ENTER row

  @AC-7 @FR-3
  Scenario: Unspecified action filter returns all actions
    Given the user's queue has an ENTER row and a REDUCE row
    When the UI requests ListOpportunities with action_filter = OPPORTUNITY_ACTION_TAG_UNSPECIFIED
    Then returned opportunities include both the ENTER and the REDUCE row

  @AC-8 @FR-4
  Scenario: Expiry sort orders by soonest valid_until while keeping symbol grouping
    Given AAPL has a row expiring at 21:00 and MSFT has a row expiring at 19:00, each the only row
      for its symbol
    When the UI requests ListOpportunities with sort = OPPORTUNITY_SORT_EXPIRY
    Then the MSFT symbol group appears before the AAPL symbol group

  @AC-9 @FR-4
  Scenario: A symbol's rows stay contiguous under expiry sort
    Given AMAT has three rows expiring at 21:00 and AAPL has one row expiring at 20:00
    When the UI requests ListOpportunities with sort = OPPORTUNITY_SORT_EXPIRY
    Then the AAPL group (soonest expiry) is positioned first
    And the three AMAT rows are returned contiguously as one symbol group

  @AC-10 @FR-4
  Scenario: Conviction sort is the default ordering
    Given the user's queue has rows with differing conviction across symbols
    When the UI requests ListOpportunities with sort = OPPORTUNITY_SORT_UNSPECIFIED
    Then the ordering is identical to sort = OPPORTUNITY_SORT_CONVICTION (the existing rank order)

  @AC-11 @FR-5
  Scenario: available_sources reflects the full queue independent of active filters
    Given the user's queue contains rows from sources "live_strategy", "sec_edgar_8k", and "fundamentals"
    When the UI requests ListOpportunities with sources = ["live_strategy"] and min_conviction 0.90
    Then the response available_sources contains "live_strategy", "sec_edgar_8k", and "fundamentals"
    And the response opportunities are only the "live_strategy" rows above 0.90

  @AC-12 @FR-5
  Scenario: available_sources excludes provenance marker tokens
    Given a queue row carries provenance ["live_strategy", "position", "watchlist"]
    When the UI requests ListOpportunities
    Then available_sources contains "live_strategy"
    And available_sources does not contain "position" or "watchlist"

  @AC-13 @FR-6
  Scenario: Pagination traverses the filtered, sorted result
    Given the user's queue has 60 REDUCE rows and 60 ENTER rows across distinct symbols
    When the UI requests ListOpportunities with action_filter = OPPORTUNITY_ACTION_TAG_REDUCE and page_size 50
    Then page 1 returns 50 REDUCE rows with a next_page_token
    And following next_page_token returns the remaining 10 REDUCE rows and no ENTER rows

  @AC-14 @FR-7
  Scenario: Changing a filter in place refetches without remounting
    Given the Opportunities page is mounted and showing the current queue
    When the user raises the min-conviction slider from 0 to 49 without navigating away
    Then a new ListOpportunities request is issued with the updated min_conviction
    And the rendered list is the server's response for the new floor (not a re-filter of the old rows)

  @AC-15 @FR-7
  Scenario: The client does not re-filter or re-sort the server result
    Given the server returns opportunities already filtered and ordered per the request params
    When the page renders the symbol groups
    Then the rendered order matches the server response order
    And no client-side conviction floor, source, action, or sort transform is applied
