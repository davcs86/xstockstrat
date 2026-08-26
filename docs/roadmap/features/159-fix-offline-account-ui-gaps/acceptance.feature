Feature: fix-offline-account-ui-gaps (bug fix)
  Regression guard for the offline-account UI gaps found on staging
  (docs/reports/2026-08-26-offline-account-ui-gaps-defect.md).

  @AC-1 @regression
  Scenario: an offline account cannot place a broker-routed order through the order ticket
    Given an offline account is selected in /trader
    Then the broker order ticket does not submit a broker-routed order for it
    And any order the user records against the offline account is persisted NEW (awaiting a
      hand-confirmed fill), never CANCELED by a broker path

  @AC-2 @regression
  Scenario: the offline-account portfolio card hides broker-only fields
    Given an offline account is selected in /trader Book
    Then the card does not present Cash, Buying Power, or broker Day P&L as if they were real
    And it shows only the fields meaningful for an offline account (positions market value,
      unrealized P&L, and account-grain Realized P&L)

  @AC-3 @regression
  Scenario: the combined/all-accounts header does not blend offline balances into broker aggregates
    Given a user holds both a broker account and an offline account
    Then the combined Cash / Buying Power aggregates exclude the offline account (which has none)
    And the combined figures are not misrepresented by the offline account's absent balance
