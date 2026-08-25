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
    Given the trader opened "/trader/positions/CAPR" by activating an opportunity
    When the position-detail page renders its breadcrumb
    Then within the "Position path" breadcrumb, the first crumb is labeled "Opportunities" and links to "/insights/opportunities"

  @AC-8 @FR-3
  Scenario: Position detail always breadcrumbs back to Opportunities, even from Exposure
    Given the trader opened "/trader/positions/CAPR" from the Exposure table
    When the position-detail page renders its breadcrumb
    Then within the "Position path" breadcrumb, the first crumb is labeled "Opportunities" and links to "/insights/opportunities", not "Exposure"

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
  Scenario: A source that vanishes on refetch does not silently strand the queue
    Given the trader has selected only the "screener" source pill and rows are visible
    When a background refetch returns a queue that no longer contains any "screener"-sourced rows
    Then the queue does not become stuck empty with no active pill — the view falls back to showing the available rows and no phantom "screener" filter remains applied

  @AC-13 @FR-1
  Scenario: The "Why this fired" panel shows the same firing state cue
    Given the trader opens "/trader/positions/HYLN?strategy=quality-dip-buy" whose 3 of 3 entry conditions pass
    When the "Why this fired" (SignalReadiness) panel renders its summary line
    Then it shows the firing state cue — the same firing icon and buy/green color used on the Watchlists and Opportunities surfaces — alongside its "3/3 conditions" text
