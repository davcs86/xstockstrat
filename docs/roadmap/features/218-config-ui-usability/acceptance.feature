Feature: config-ui-usability
  As an operator editing runtime config in the config-ui, I want to switch namespaces from a
  dropdown above the keys table, see a brief description and last-updated time on each row, and
  type into the edit form without focus jumping, so that reviewing and changing config is fast.

  @AC-1 @FR-1
  Scenario: Landing page shows the platform namespace table with a namespace dropdown
    Given an admin session
    When the operator opens "/config-ui?env=staging"
    Then a combobox labelled "Namespace" shows "platform"
    And the keys table for namespace "platform" is rendered below it
    And no namespace card grid is rendered

  @AC-2 @FR-2
  Scenario: Selecting a namespace navigates and preserves env and user scope
    Given the operator is on "/config-ui/platform?env=staging&user=u-123"
    When the operator selects "marketdata" in the "Namespace" combobox
    Then the URL becomes "/config-ui/marketdata?env=staging&user=u-123"
    And the "Namespace" combobox shows "marketdata"

  @AC-3 @FR-2
  Scenario: Deep link to a namespace pre-selects it
    When the operator opens "/config-ui/trading?env=staging"
    Then the "Namespace" combobox shows "trading"
    And the keys table lists the "trading" keys

  @AC-4 @FR-3
  Scenario: Description renders clamped under the key with a full-text tooltip
    Given key "marketdata.fmp.metrics" has description "Comma-separated metric tiers to fetch (core, extended)"
    When the operator views the "marketdata" namespace at a 375px-wide viewport
    Then the row for "marketdata.fmp.metrics" shows "Comma-separated metric tiers to fetch (core, extended)" under the key
    And that description element has title "Comma-separated metric tiers to fetch (core, extended)"
    And no column header "Description" exists

  @AC-5 @FR-3
  Scenario: Empty description renders nothing
    Given key "marketdata.fmp.enabled" has description ""
    When the operator views the "marketdata" namespace
    Then the row for "marketdata.fmp.enabled" contains no description element

  @AC-6 @FR-4
  Scenario: ListKeys returns the resolved row's updated_at
    Given a global row "platform.trading_state" in staging with updated_at "2026-09-01T10:00:00Z"
    And a per-user row "platform.trading_state" for user "u-123" in staging with updated_at "2026-09-15T08:30:00Z"
    When ListKeys is called with namespace "platform", environment STAGING, user_id "u-123"
    Then the "platform.trading_state" entry has updated_at "2026-09-15T08:30:00Z"
    When ListKeys is called with namespace "platform", environment STAGING, user_id ""
    Then the "platform.trading_state" entry has updated_at "2026-09-01T10:00:00Z"

  @AC-7 @FR-4
  Scenario: Secret rows still expose no value but do carry updated_at
    Given a secret row "marketdata.alpaca.api_key" with updated_at "2026-09-20T12:00:00Z"
    When ListKeys is called for namespace "marketdata"
    Then the entry has current_value "[redacted]"
    And the entry has updated_at "2026-09-20T12:00:00Z"

  @AC-8 @FR-5
  Scenario: Row shows last-updated time with ISO tooltip
    Given ListKeys returns key "platform.trading_state" with updatedAt "2026-09-15T08:30:00Z"
    When the operator views the "platform" namespace
    Then the row for "platform.trading_state" shows a last-updated cell with title "2026-09-15T08:30:00.000Z"

  @AC-9 @FR-5
  Scenario: Row without updated_at shows a dash
    Given ListKeys returns key "platform.example" with no updatedAt
    When the operator views the "platform" namespace
    Then the last-updated cell for "platform.example" shows "—"

  @AC-10 @FR-6
  Scenario: Typing a reason keeps focus in the reason input
    Given the operator is editing "platform.trading_state"
    When the operator clicks the reason input and types "halting for maintenance"
    Then the reason input has focus
    And the reason input value is "halting for maintenance"
    And the value input value is unchanged

  @AC-11 @FR-6
  Scenario: Typing a value keeps focus and the same input element
    Given the operator is editing "platform.trading_state"
    When the operator types "halted" into the value input one character at a time
    Then the value input has focus after every keystroke
    And the value input value is "halted"

  @AC-12 @FR-7
  Scenario: Save refreshes the row value without reload
    Given the operator is editing "platform.trading_state" with reason "maintenance"
    When the operator sets the value to "halted" and clicks "Save"
    Then the row for "platform.trading_state" shows value "halted"
    And the edit inputs are closed
