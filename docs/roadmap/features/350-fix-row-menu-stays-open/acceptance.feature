Feature: fix-row-menu-stays-open (bug fix)
  Regression guard for docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md:
  a row's actions menu stayed open after a confirmed action and swallowed the next click.

  @AC-1 @FR-1 @regression
  Scenario Outline: Choosing an action that asks for confirmation closes the row menu
    Given the <table> table with a row whose "<action>" action asks for confirmation
    When the user opens that row's actions menu and chooses "<action>"
    Then the confirmation dialog is shown
    And the row's actions menu is no longer shown

    Examples:
      | table    | action |
      | orders   | Cancel |
      | accounts | Resume |

  @AC-2 @FR-2 @regression
  Scenario Outline: The page responds to the first click after the dialog is resolved
    Given the user chose "<action>" from a row's actions menu on the <table> table
    When the user <resolution> the confirmation dialog
    Then no actions menu and no dialog is shown
    And the page is not blocked from pointer input
    And a single click on another control on the page performs that control's action

    Examples:
      | table    | action | resolution |
      | orders   | Cancel | confirms   |
      | orders   | Cancel | dismisses  |
      | accounts | Resume | confirms   |
      | accounts | Resume | dismisses  |

  @AC-3 @FR-3 @regression
  Scenario Outline: Focus returns to the row's actions trigger after the dialog is resolved
    Given the user chose "<action>" from a row's actions menu on the <table> table
    When the user <resolution> the confirmation dialog
    And the row is still in the table
    Then keyboard focus is on that row's actions trigger

    Examples:
      | table    | action | resolution |
      | orders   | Cancel | dismisses  |
      | accounts | Resume | confirms   |
      | accounts | Resume | dismisses  |

  @AC-4 @FR-3 @regression
  Scenario: Focus is not lost when the row leaves the table
    Given the user chose "Cancel" from an order's actions menu
    When the user confirms and the order leaves the table
    Then keyboard focus is not on a removed element
    And the next Tab press moves focus to a control on the page

  @AC-5 @FR-1 @regression
  Scenario: The confirmation flow works from the keyboard alone
    Given a row's actions trigger has keyboard focus
    When the user opens the menu with Enter, moves to an action that asks for confirmation and presses Enter
    Then the confirmation dialog is shown with focus inside it
    And pressing Escape closes the dialog and returns focus to the row's actions trigger

  @AC-6 @FR-4 @regression
  Scenario: Every confirm action on the shared row menu behaves the same
    Given a table that uses the shared row menu with an action that asks for confirmation
    When the user chooses that action and confirms or cancels the dialog
    Then the row's actions menu is closed and the page responds to the first click

  @AC-7 @FR-5
  Scenario: Actions without confirmation and keep-open items are unchanged
    Given a row action that does not ask for confirmation
    When the user chooses it
    Then the action runs at once and the menu closes
    And on the opportunities source filter, ticking a source keeps the filter menu open
