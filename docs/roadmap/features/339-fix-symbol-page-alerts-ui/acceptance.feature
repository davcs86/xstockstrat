Feature: fix-symbol-page-alerts-ui (bug fix)
  Regression guard for docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md.

  @AC-1 @FR-1 @FR-2 @regression
  Scenario Outline: A large market cap fits its Fundamentals tile at mobile width
    Given the symbol page for "LYFT" at a 384px-wide viewport
    And fundamentals with a market cap of <market_cap> and a P/E of 41.2
    When the Research tab is shown
    Then the market cap value is displayed wholly inside the "Market cap" tile
    And the market cap value does not overlap the P/E value
    And each Fundamentals tile shows its label above its value

    Examples:
      | market_cap       |
      | 6726553623.93    |
      | 3450000000000.00 |

  @AC-2 @FR-4 @regression
  Scenario: A strategy-less opportunity chip is labelled by its source
    Given opportunities for "LYFT" from strategy "dip_buyer_vol_stop" and one with an empty strategy id and source "fundamentals"
    When the Research tab is shown at mobile width
    Then the chip row shows "dip_buyer_vol_stop" and "Fundamentals"
    And no chip is labelled "LYFT"

  @AC-3 @FR-5 @FR-8 @regression
  Scenario: The Alerts drawer shows a stored unread alert that was not streamed
    Given one stored unread alert titled "Backfill 67276d1f failed" and one stored read alert titled "Backfill 11aa22bb done"
    And no alert streamed since page load
    When the header bell showing badge "1" is opened
    Then the drawer lists "Backfill 67276d1f failed"
    And the drawer does not list "Backfill 11aa22bb done"
    And the Notifications page shows 1 unread alert

  @AC-4 @FR-6 @FR-7 @regression
  Scenario: Marking an alert read in the drawer clears it and the badge
    Given the drawer lists one unread alert titled "Backfill 67276d1f failed" and the badge shows "1"
    When the alert is marked read in the drawer
    Then the drawer shows "No alerts"
    And the bell shows no unread badge
    And the Notifications page shows "Backfill 67276d1f failed" as read

  @AC-5 @FR-5 @FR-7 @regression
  Scenario: A streamed alert raises the badge without a reload
    Given one stored unread alert titled "Backfill 67276d1f failed", the badge shows "1" and the drawer is closed
    When an alert titled "Order rejected" is streamed
    Then the badge shows "2"
    And the opened drawer lists "Order rejected" above "Backfill 67276d1f failed"

  @AC-6 @FR-9 @regression
  Scenario: A checked switch is displayed on
    Given push notifications are enabled on this device
    When the Notifications page is shown
    Then the push switch reports checked "true"
    And the push switch is displayed in its on position, with the thumb at the trailing end of the track

  @AC-7 @FR-9 @regression
  Scenario: An unchecked switch is displayed off
    Given push notifications are not enabled on this device
    When the Notifications page is shown
    Then the push switch reports checked "false"
    And the push switch is displayed in its off position, with the thumb at the leading end of the track

  @AC-8 @FR-3 @regression
  Scenario: A long value fits its tile in the symbol page's other stat grids
    Given the symbol page for "LYFT" at a 384px-wide viewport
    And an open position with a cost basis of 1234567890.12 and a last price of 16.42
    When the position stat grid is shown
    Then the cost basis value is displayed wholly inside the "Cost basis" tile
    And the cost basis value does not overlap any neighbouring tile's value

  @AC-9 @FR-5 @FR-8 @regression
  Scenario: An alert that is both stored and streamed appears once
    Given no stored unread alert and the drawer is closed
    When an alert titled "Order rejected" is streamed and is then also returned as a stored unread alert
    Then the opened drawer lists "Order rejected" exactly once
    And the badge shows "1"

  @AC-10 @FR-10 @regression
  Scenario: Clear all marks every unread alert read, persists, and empties the drawer and badge
    Given two stored unread alerts titled "Backfill 9f8e7d6c failed" and "Daily loss limit reached" and the badge shows "2"
    And no alert streamed since page load
    When "Clear all" is pressed in the opened drawer
    Then the drawer shows "No alerts"
    And the bell shows no unread badge
    And the Notifications page shows "Backfill 9f8e7d6c failed" and "Daily loss limit reached" as read

  @AC-11 @FR-9 @regression
  Scenario: A checked checkbox is displayed filled
    Given the sign-in page with "Remember me for 14 days" unchecked
    When "Remember me for 14 days" is checked
    Then the checkbox reports checked "true"
    And the checkbox is displayed with a fill that differs from its unchecked fill

  @AC-12 @FR-11 @regression
  Scenario Outline: A shared component is displayed with its state styling
    Given a page that shows a <component> that is <state>
    When the page is displayed
    Then the <component> is displayed with <styling>

    Examples:
      | component                          | state      | styling                                                 |
      | "Strategy" tab on Config templates | selected   | a background the unselected "Formula" tab does not have |
      | dialog, menu, sheet or tooltip     | opening    | its opening animation                                   |
      | dialog, menu, sheet or tooltip     | closing    | its closing animation                                   |
      | separator                          | horizontal | a line 1 pixel high across its container                |
      | separator                          | vertical   | a line 1 pixel wide down its container                  |
      | option list of a combobox          | scrollable | no visible scrollbar                                    |
