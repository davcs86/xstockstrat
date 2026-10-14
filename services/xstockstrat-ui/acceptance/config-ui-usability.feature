# Promoted from docs/roadmap/features/219-config-ui-usability/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-219` tag.
# Durable business rules the UI already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: xstockstrat-ui — config-ui namespace editor usability
  What the config-ui guarantees for namespace switching, per-row description and last-updated
  display, stable edit-form focus, and post-save refresh.

  @AC-1 @FR-1 @feature-219
  Scenario: Landing page shows the platform namespace table with a namespace dropdown
    Given an admin session
    When the operator opens "/config-ui?env=staging"
    Then a combobox labelled "Namespace" shows "platform"
    And the keys table for namespace "platform" is rendered below it
    And no namespace card grid is rendered

  @AC-2 @FR-2 @feature-219
  Scenario: Selecting a namespace navigates and preserves env and user scope
    Given the operator "test-user-001" is on "/config-ui/platform?env=staging&user=test-user-001"
    When the operator selects "marketdata" in the "Namespace" combobox
    Then the URL becomes "/config-ui/marketdata?env=staging&user=test-user-001"
    And the "Namespace" combobox shows "marketdata"

  @AC-3 @FR-2 @feature-219
  Scenario: Deep link to a namespace pre-selects it
    When the operator opens "/config-ui/trading?env=staging"
    Then the "Namespace" combobox shows "trading"
    And the keys table lists the "trading" keys

  @AC-4 @FR-3 @feature-219
  Scenario: Description renders clamped under the key with a full-text tooltip
    Given key "marketdata.fmp.metrics" has description "Comma-separated metric tiers to fetch (core, extended)"
    When the operator views the "marketdata" namespace at a 375px-wide viewport
    Then the row for "marketdata.fmp.metrics" shows "Comma-separated metric tiers to fetch (core, extended)" under the key
    And that description element has title "Comma-separated metric tiers to fetch (core, extended)"
    And no column header "Description" exists

  @AC-5 @FR-3 @feature-219
  Scenario: Empty description renders nothing
    Given key "marketdata.fmp.enabled" has description ""
    When the operator views the "marketdata" namespace
    Then the row for "marketdata.fmp.enabled" contains no description element

  @AC-8 @FR-5 @feature-219
  Scenario: Row shows last-updated time with ISO tooltip
    Given ListKeys returns key "platform.trading_state" with updatedAt "2026-09-15T08:30:00Z"
    When the operator views the "platform" namespace
    Then the row for "platform.trading_state" shows a last-updated cell with title "2026-09-15T08:30:00.000Z"
    And that cell's visible text contains "2026"

  @AC-9 @FR-5 @feature-219
  Scenario: Row without updated_at shows a dash
    Given ListKeys returns key "platform.example" with no updatedAt
    When the operator views the "platform" namespace
    Then the last-updated cell for "platform.example" shows "—"

  @AC-10 @FR-6 @feature-219
  Scenario: Typing a reason keeps focus in the reason input
    Given the operator is editing "platform.trading_state"
    When the operator clicks the reason input and types "halting for maintenance"
    Then the reason input has focus
    And the reason input value is "halting for maintenance"
    And the value input value is unchanged

  @AC-11 @FR-6 @feature-219
  Scenario: Typing a value keeps focus and the same input element
    Given the operator is editing "platform.trading_state"
    When the operator types "halted" into the value input one character at a time
    Then the value input has focus after every keystroke
    And the value input value is "halted"

  @AC-12 @FR-7 @feature-219
  Scenario: Save refreshes the row value without reload
    Given ListKeys returns key "platform.trading_state" with no updatedAt before the save
    And returns updatedAt "2026-10-02T09:00:00Z" for it after the save
    And the operator is editing "platform.trading_state" with reason "maintenance"
    When the operator sets the value to "halted" and clicks "Save"
    Then the row for "platform.trading_state" shows value "halted"
    And the last-updated cell for "platform.trading_state" has title "2026-10-02T09:00:00.000Z"
    And the edit inputs are closed

  @AC-14 @FR-2 @feature-219
  Scenario: Namespace page keeps the env switcher, scope control and a non-link breadcrumb
    When the operator opens "/config-ui/marketdata?env=staging"
    Then the env switcher and scope control are visible above the table
    And the "Namespace path" breadcrumb ends with "marketdata"
    And the breadcrumb contains no "← namespaces" link
