Feature: fix-symbol-page-alerts-ui (bug fix)
  Regression guard for docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md.

  @AC-1 @regression
  Scenario: A multi-billion market cap fits its Fundamentals tile at mobile width
    Given the symbol page for "LYFT" at a 384px-wide viewport
    And fundamentals with a market cap of 6726553623.93
    When the Research tab is shown
    Then the market cap tile shows "$6.73B"
    And the market cap value does not overlap the P/E value

  @AC-2 @regression
  Scenario: A strategy-less opportunity chip is labelled by its source
    Given opportunities for "LYFT" from strategy "dip_buyer_vol_stop" and one with an empty strategy id and source "fundamentals"
    When the Research tab is shown at mobile width
    Then the chip row shows "dip_buyer_vol_stop" and "Fundamentals"
    And no chip is labelled "LYFT"

  @AC-3 @regression
  Scenario: The Alerts drawer shows a stored unread alert that was not streamed
    Given one stored unread alert titled "Backfill 67276d1f failed" and no alert streamed since page load
    When the header bell showing badge "1" is opened
    Then the drawer lists "Backfill 67276d1f failed"

  @AC-4 @regression
  Scenario: Marking an alert read in the drawer clears it and the badge
    Given the drawer lists one unread alert and the badge shows "1"
    When the alert is marked read in the drawer
    Then the drawer shows "No alerts"
    And the bell shows no unread badge

  @AC-5 @regression
  Scenario: A streamed alert raises the badge without a reload
    Given the badge shows "1" and the drawer is closed
    When an alert titled "Order rejected" is streamed
    Then the badge shows "2"
    And the drawer lists "Order rejected" above the stored alert

  @AC-6 @regression
  Scenario: A checked switch renders in the checked position
    Given push notifications are enabled on this device
    When the Notifications page is shown
    Then the push switch has aria-checked "true"
    And its thumb is rendered at the checked (right) position with the primary fill
