# Promoted from docs/roadmap/features/350-fix-row-menu-stays-open/acceptance.feature (Constitution C-16).
# Provenance: @feature-350.

Feature: fix-row-menu-stays-open (bug fix)
  Regression guard for docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md:
  a row's actions menu stayed open after a confirmed action and swallowed the next click.

  @AC-1 @FR-1 @regression @feature-350
  Scenario Outline: Choosing an action that asks for confirmation closes the row menu
    Given the <table> table with a row whose "<action>" action asks for confirmation
    When the user opens that row's actions menu and chooses "<action>"
    Then the confirmation dialog is shown
    And the row's actions menu is no longer shown

    Examples:
      | table    | action |
      | orders   | Cancel |
      | accounts | Resume |

  @AC-2 @FR-2 @regression @feature-350
  Scenario Outline: The page responds to the first click after the dialog is resolved
    Given the user chose "<action>" from a row's actions menu on the <table> table
    When the user <resolution> the confirmation dialog
    Then no actions menu and no dialog is shown
    And the page is not blocked from pointer input
    And no page content is left hidden from assistive technology
    And a single click on another control on the page performs that control's action

    Examples:
      | table    | action | resolution |
      | orders   | Cancel | confirms   |
      | orders   | Cancel | dismisses  |
      | accounts | Resume | confirms   |
      | accounts | Resume | dismisses  |

  @AC-3 @FR-3 @regression @feature-350
  Scenario Outline: Focus returns to the row's actions trigger after the dialog is resolved
    Given the user chose "<action>" from a row's actions menu on the <table> table
    And the row stays in the table after the action
    When the user <resolution> the confirmation dialog
    Then keyboard focus is on that row's actions trigger

    Examples:
      | table    | action | resolution |
      | orders   | Cancel | dismisses  |
      | orders   | Cancel | confirms   |
      | accounts | Resume | confirms   |
      | accounts | Resume | dismisses  |

  @AC-4 @FR-3 @regression @feature-350
  Scenario Outline: Focus is not lost when the row's actions trigger disappears
    Given the user chose "<action>" from a row's actions menu on the <table> table
    When the user confirms and the row's actions trigger is removed from the page
    Then keyboard focus is on the page's main content region
    And the next Tab press moves focus to the first control inside the main content region

    Examples:
      | table           | action     |
      | authorized apps | Disconnect |
      | accounts        | Remove     |

  @AC-5 @FR-1 @regression @feature-350
  Scenario: The confirmation flow works from the keyboard alone
    Given the actions trigger of a cancellable order on the orders table has keyboard focus
    When the user opens the menu with Enter, moves to "Cancel" and presses Enter
    Then the confirmation dialog is shown with focus inside it
    And pressing Escape closes the dialog and returns focus to that order's actions trigger

  @AC-6 @FR-4 @regression @feature-350
  Scenario Outline: Every confirm action behaves the same on every table
    Given the <table> table with a row whose "<action>" action asks for confirmation
    When the user chooses "<action>" from that row's actions menu and <resolution> the dialog
    Then the row's actions menu is closed
    And the page responds to the first click

    Examples:
      | table            | action     | resolution |
      | accounts         | Remove     | dismisses  |
      | authorized apps  | Disconnect | dismisses  |
      | config templates | Retire     | dismisses  |
      | strategies       | Deactivate | dismisses  |
      | strategies       | Deactivate | confirms   |

  @AC-7 @FR-5 @feature-350
  Scenario: Actions without confirmation and keep-open items are unchanged
    Given the orders table with a row whose "Edit" action does not ask for confirmation
    When the user chooses "Edit" from that row's actions menu
    Then the edit dialog opens at once and the row's actions menu closes
    And on the opportunities source filter, ticking a source keeps the filter menu open

  @AC-8 @FR-2 @regression @feature-350
  Scenario: A key pressed right after confirming is not swallowed by a leftover menu
    Given the user chose "Cancel" from an order's actions menu
    When the user confirms the dialog
    Then no actions menu is shown without any further key press or click

  @AC-9 @FR-3 @FR-4 @regression @feature-350
  Scenario Outline: Focus stays on the row's actions trigger when the page updates during the confirmation
    Given the <table> table with a row whose actions trigger is named "<trigger>"
    And the user chose "<action>" from that row's actions menu
    When the user confirms the dialog and <outcome>
    Then <shown>
    And keyboard focus is on the actions trigger named "<trigger>"

    Examples:
      | table            | trigger                                     | action     | outcome                                                              | shown                                                             |
      | strategies       | Actions for strat-live-001                  | Deactivate | the strategy list is reloaded with "strat-live-001" switched off     | the row for "strat-live-001" shows the state "Off"                |
      | authorized apps  | Actions for Claude.ai (E2E)                 | Disconnect | the disconnect fails                                                 | the message "Failed to disconnect (500)" is shown above the table |
      | config templates | Actions for template Mean Reversion Starter | Retire     | the server refuses the retire with the message "template is in use" | the message "template is in use" is shown above the templates     |

  @AC-10 @FR-1 @regression @feature-350
  Scenario: Focus does not leave the confirmation dialog while the row menu finishes closing
    Given the actions trigger of the "Alpaca Paper" account on the accounts table has keyboard focus
    When the user opens the menu with Enter, moves to "Remove" with End and presses Enter
    Then the "Deregister account" dialog is shown with focus on its "Cancel" button
    And once the row's actions menu has finished closing, focus has stayed on "Cancel" without leaving it and coming back
