Feature: offline-account UI correctness (promoted from feature 159)
  Durable business-rule guarantees for how the /trader UI treats an OFFLINE
  (manually-tracked, non-broker) account. Promoted at launch from
  docs/roadmap/features/159-fix-offline-account-ui-gaps/acceptance.feature (C-16).
  The backend halves (offline order recorded NEW / never broker-CANCELED; combined
  ListPortfolios enumerates offline accounts) are guarded by the trading and
  portfolio Go tests those services own.

  @AC-1 @FR-1 @FR-2 @feature-159 @regression
  Scenario: an offline account cannot place a broker-routed order through the order ticket
    Given an offline account "Schwab 4737" is selected in /trader
    When the user attempts a HONA BUY 1 market order
    Then the broker order ticket is replaced by an offline "Record order" control
    And the order the user records is persisted NEW (awaiting a hand-confirmed fill),
      never CANCELED by a broker path

  @AC-2 @FR-3 @feature-159 @regression
  Scenario: the offline-account portfolio card hides broker-only fields
    Given an offline account "Schwab 4737" is selected in /trader Book
    Then the card does not present Cash, Buying Power, or broker Day P&L as if they were real
    And it shows only the fields meaningful for an offline account (positions market value,
      unrealized P&L, and account-grain Realized P&L)

  @AC-3 @FR-4 @feature-159 @regression
  Scenario: the combined/all-accounts view does not blend offline balances into broker aggregates
    Given a user holds both a broker account "Alpaca Paper" and an offline account "Schwab 4737"
    Then the combined Cash / Buying Power aggregates exclude the offline account (which has none)
    And the broker account's own card still shows its broker figures

  @AC-4 @FR-4 @feature-159 @regression
  Scenario: the offline account is visible in the combined view with only meaningful fields
    Given a user holds both a broker account "Alpaca Paper" and an offline account "Schwab 4737"
    When they view the combined / all-accounts portfolio
    Then the offline account appears as its own card showing only positions market value, unrealized
      P&L, and account-grain Realized P&L
    And that card does not present Cash, Buying Power, or broker Day P&L
