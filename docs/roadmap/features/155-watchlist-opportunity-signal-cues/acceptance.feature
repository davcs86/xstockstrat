Feature: watchlist-opportunity-signal-cues
  As a trader scanning watchlists and opportunities, I want firing/ready and in-queue
  states clearly distinguishable with consistent color + icon codes, and the small
  navigation/mobile/filter rough edges fixed, so that I can act on the strongest signals faster.

  @AC-1 @FR-1
  Scenario: A firing readiness row shows the firing color and firing icon
    Given a Watchlists readiness row for "ELWT" bound to a strategy whose 3 of 3 entry conditions pass
    When the readiness panel renders the row
    Then the row shows the "firing" state with its buy/green color, its firing icon, and the text "firing"

  @AC-2 @FR-1
  Scenario: A partway readiness row shows the watching color and watching icon
    Given a Watchlists readiness row for "BE" whose 2 of 3 entry conditions pass
    When the readiness panel renders the row
    Then the row shows the "watching" state with its paper/amber color, its watching icon, and the text "1 away"

  @AC-3 @FR-1
  Scenario: The in-queue marker is icon-coded consistently on watchlists and opportunities
    Given the symbol "CAPR" appears in the opportunities queue
    When the Watchlists readiness row for "CAPR" and the Opportunities card for "CAPR" both render
    Then each shows an "in queue" badge carrying the same in-queue icon and info color used by the shared state map

  @AC-4 @FR-1
  Scenario: Every state icon is paired with text, never icon-only
    Given a readiness row in any of the states firing, watching, quiet, or no-data
    When the row renders
    Then the state's text label ("firing" / "N away" / "quiet" / "no data") is present alongside the icon so color and icon are never the sole differentiator

  @AC-5 @FR-2
  Scenario: A firing watchlist row offers a jump to the symbol's order detail
    Given a Watchlists readiness row for "HYLN" in the firing state bound to strategy "quality-dip-buy"
    When the trader activates the row's jump-to-detail action
    Then the browser navigates to "/trader/positions/HYLN?strategy=quality-dip-buy"

  @AC-6 @FR-2
  Scenario: A non-firing watchlist row does not offer the jump action
    Given a Watchlists readiness row for "AARD" in the "2 away" state
    When the readiness panel renders the row
    Then no jump-to-detail action is shown on that row

  @AC-7 @FR-3
  Scenario: Position detail reached from Opportunities returns to the Opportunities queue
    Given the trader opened "/trader/positions/CAPR?from=opportunities" by activating an opportunity
    When the position-detail page renders its breadcrumb
    Then the first breadcrumb crumb is labeled "Opportunities" and links to "/insights/opportunities"

  @AC-8 @FR-3
  Scenario: Position detail reached from Exposure keeps the Exposure breadcrumb
    Given the trader opened "/trader/positions/CAPR" from the Exposure table with no opportunities origin
    When the position-detail page renders its breadcrumb
    Then the first breadcrumb crumb is labeled "Exposure" and links to "/trader/positions"

  @AC-9 @FR-4
  Scenario: Mobile Opportunities groups signals by symbol
    Given two opportunities for symbol "CAPR" (strategies "quality-dip-buy" and "momentum") in the queue
    When the Opportunities page renders on a mobile viewport
    Then "CAPR" appears as a single grouped card containing both signals, not two separate top-level rows

  @AC-10 @FR-4
  Scenario: Mobile Opportunities shows the strategy, source, and expiry tags
    Given an opportunity for "CAPR" with strategy "quality-dip-buy", source "watchlist", and an expiry time of 14:30
    When the Opportunities page renders on a mobile viewport
    Then the "CAPR" signal shows the strategy id, a "watchlist" source chip, and the expiry "14:30"

  @AC-11 @FR-5
  Scenario: Selecting a source filter immediately narrows the queue
    Given the Opportunities queue contains rows from sources "watchlist" and "screener"
    When the trader selects only the "watchlist" source pill
    Then the "watchlist" pill shows as active and only "watchlist"-sourced rows remain visible

  @AC-12 @FR-5
  Scenario: Clearing filters restores the full queue without stale pills
    Given the trader has the "screener" source pill and the "Reduce" action filter active
    When the trader clicks "All sources" and sets the action filter back to "Any action"
    Then no source pill shows as active, the action filter reads "Any action", and every unmuted row is visible again
