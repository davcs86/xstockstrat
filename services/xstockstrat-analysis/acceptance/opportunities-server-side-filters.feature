# Promoted from docs/roadmap/features/190-opportunities-server-side-filters/acceptance.feature at
# archive time (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-190` tag. Durable business rules xstockstrat-analysis guarantees for ListOpportunities:
# the min-conviction floor, source and action filters, and the sort are evaluated server-side across
# the whole materialized queue (never a client-side approximation over loaded pages); muted/data-
# unavailable rows are exempt from the floor; available_sources reflects the full queue independent of
# active filters; and pagination traverses the filtered+sorted result. A rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. (AC-14/AC-15 are the UI
# refetch/no-client-transform guarantees, promoted to the ui suite.)

Feature: opportunities-server-side-filters (analysis-service guarantees)
  What xstockstrat-analysis guarantees for the ranked opportunity queue: the min-conviction floor,
  source and action filters, and the sort are applied server-side over the whole queue, so what a
  trader sees and pages through is authoritative rather than a client-side approximation over loaded
  pages.

  @AC-1 @FR-1 @feature-190
  Scenario: Min-conviction floor is applied by the server, not the client
    Given the user's materialized queue has an ENTER row for AAPL with conviction 0.80 and an
      ENTER row for MSFT with conviction 0.30, both valid and non-muted
    When the UI requests ListOpportunities with min_conviction 0.50
    Then the response opportunities include AAPL and exclude MSFT
    And the request sent on the wire carries min_conviction 0.50 (not a hard-coded 0.0)

  @AC-2 @FR-1 @feature-190
  Scenario: A muted row survives a raised min-conviction floor
    Given the user's queue has a muted (provenance contains "denied") row for TSLA with conviction 0.0
    When the UI requests ListOpportunities with min_conviction 0.50
    Then the response opportunities still include the muted TSLA row

  @AC-3 @FR-1 @feature-190
  Scenario: A data-unavailable row survives a raised min-conviction floor
    Given the user's queue has a data-unavailable (provenance contains "unavailable") row for NVDA
      with conviction 0.0
    When the UI requests ListOpportunities with min_conviction 0.50
    Then the response opportunities still include the data-unavailable NVDA row

  @AC-4 @FR-2 @feature-190
  Scenario: Source filter returns only matching sources
    Given the user's queue has a row whose primary source is "live_strategy" and a row whose
      primary source is "sec_edgar_8k"
    When the UI requests ListOpportunities with sources = ["live_strategy"]
    Then every returned opportunity has source "live_strategy"
    And no returned opportunity has source "sec_edgar_8k"

  @AC-5 @FR-2 @feature-190
  Scenario: Empty source filter returns all sources
    Given the user's queue has rows from sources "live_strategy" and "sec_edgar_8k"
    When the UI requests ListOpportunities with sources = []
    Then returned opportunities include both "live_strategy" and "sec_edgar_8k" rows

  @AC-6 @FR-3 @feature-190
  Scenario: Action filter returns only the selected action
    Given the user's queue has an ENTER row for AHR and a REDUCE row for AMAT
    When the UI requests ListOpportunities with action_filter = OPPORTUNITY_ACTION_TAG_REDUCE
    Then returned opportunities include the AMAT REDUCE row
    And returned opportunities exclude the AHR ENTER row

  @AC-7 @FR-3 @feature-190
  Scenario: Unspecified action filter returns all actions
    Given the user's queue has an ENTER row and a REDUCE row
    When the UI requests ListOpportunities with action_filter = OPPORTUNITY_ACTION_TAG_UNSPECIFIED
    Then returned opportunities include both the ENTER and the REDUCE row

  @AC-8 @FR-4 @feature-190
  Scenario: Expiry sort orders by soonest valid_until while keeping symbol grouping
    Given AAPL has a row expiring at 21:00 and MSFT has a row expiring at 19:00, each the only row
      for its symbol
    When the UI requests ListOpportunities with sort = OPPORTUNITY_SORT_EXPIRY
    Then the MSFT symbol group appears before the AAPL symbol group

  @AC-9 @FR-4 @feature-190
  Scenario: A symbol's rows stay contiguous under expiry sort
    Given AMAT has three rows expiring at 21:00 and AAPL has one row expiring at 20:00
    When the UI requests ListOpportunities with sort = OPPORTUNITY_SORT_EXPIRY
    Then the AAPL group (soonest expiry) is positioned first
    And the three AMAT rows are returned contiguously as one symbol group

  @AC-10 @FR-4 @feature-190
  Scenario: Conviction sort is the default ordering
    Given the user's queue has rows with differing conviction across symbols
    When the UI requests ListOpportunities with sort = OPPORTUNITY_SORT_UNSPECIFIED
    Then the ordering is identical to sort = OPPORTUNITY_SORT_CONVICTION (the existing rank order)

  @AC-11 @FR-5 @feature-190
  Scenario: available_sources reflects the full queue independent of active filters
    Given the user's queue contains rows from sources "live_strategy", "sec_edgar_8k", and "fundamentals"
    When the UI requests ListOpportunities with sources = ["live_strategy"] and min_conviction 0.90
    Then the response available_sources contains "live_strategy", "sec_edgar_8k", and "fundamentals"
    And the response opportunities are only the "live_strategy" rows above 0.90

  @AC-12 @FR-5 @feature-190
  Scenario: available_sources excludes provenance marker tokens
    Given a queue row carries provenance ["live_strategy", "position", "watchlist"]
    When the UI requests ListOpportunities
    Then available_sources contains "live_strategy"
    And available_sources does not contain "position" or "watchlist"

  @AC-13 @FR-6 @feature-190
  Scenario: Pagination traverses the filtered, sorted result
    Given the user's queue has 60 REDUCE rows and 60 ENTER rows across distinct symbols
    When the UI requests ListOpportunities with action_filter = OPPORTUNITY_ACTION_TAG_REDUCE and page_size 50
    Then page 1 returns 50 REDUCE rows with a next_page_token
    And following next_page_token returns the remaining 10 REDUCE rows and no ENTER rows
