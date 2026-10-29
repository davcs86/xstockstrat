# Promoted from docs/roadmap/features/263-fix-edge-owner-scope/acceptance.feature on launch
# (C-16). Scenarios are verbatim; each carries its source `@AC-*` and a `@feature-263` tag.
# Durable business rule xstockstrat-ui guarantees: the trader BFF LedgerService.QueryEvents never returns
# another user's (or an unowned) event, while a trader still reads their own streams. A rule enters only by promotion.
Feature: fix-edge-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-edge-owner-scope-defect.md:
  trader BFF ledger queryEvents and agent get_config / list_config_keys read other users' data (debt-radar D-25, D-31).

  Background:
    Given user "u-a" owns broker account "acct-a" and user "u-b" owns broker account "acct-b"
    And the ledger holds an "order.filled" event on stream "account:acct-b" for user "u-b" symbol "AAPL"
    And the ledger holds an "order.filled" event on stream "account:acct-legacy" with a NULL user_id symbol "TSLA"

  @AC-1 @FR-1 @regression @feature-263
  Scenario: A trader cannot read another user's account stream through the trader BFF
    Given user "u-a" is signed in to /trader
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-b"
    Then the call fails with PERMISSION_DENIED
    And no event from stream "account:acct-b" is returned

  @AC-2 @FR-2 @regression @feature-263
  Scenario: A trader BFF query with no stream key returns no other user's events
    Given user "u-a" is signed in to /trader
    When "u-a" calls trader BFF LedgerService.QueryEvents with event_type "order.filled" and no stream_key
    Then the response contains no event belonging to user "u-b"
    And the response contains no event whose user_id is NULL
    And the "order.filled" event on "account:acct-legacy" symbol "TSLA" is not returned

  @AC-3 @FR-1 @FR-5 @regression @feature-263
  Scenario: A trader still reads their own account and copilot streams
    Given user "u-a" is signed in to /trader
    And the ledger holds a "reconciliation.tick" event on stream "account:acct-a"
    And the ledger holds a "copilot.message" event "note-a" on stream "copilot:u-a:default" for user "u-a"
    And the ledger holds a "copilot.message" event "note-b" on stream "copilot:u-b:default" for user "u-b"
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-a"
    Then the "reconciliation.tick" event on "account:acct-a" is returned
    And a QueryEvents with stream_key "copilot:anything" returns exactly the "note-a" event
    And the "note-b" event is not returned

  @AC-7 @FR-2 @FR-5 @regression @feature-263
  Scenario: A trader still reads their own position lineage with no stream key
    Given user "u-a" is signed in to /trader
    And the ledger holds an "order.filled" event on stream "account:acct-a" for user "u-a" symbol "MSFT"
    When "u-a" calls trader BFF LedgerService.QueryEvents with event_type "order.filled" and no stream_key
    Then the "order.filled" event for user "u-a" symbol "MSFT" is returned
