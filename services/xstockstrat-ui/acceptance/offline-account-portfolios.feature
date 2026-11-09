# Promoted from docs/roadmap/features/157-offline-account-portfolios/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-157` tag.
# Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring. These cover the /trader surfacing of
# offline accounts in the account selector and their realized P&L on the portfolio card.

Feature: xstockstrat-ui — offline accounts in /trader
  What the trader UI guarantees for offline accounts: they appear alongside broker accounts in the
  account selector with their own portfolio card, and their realized P&L is shown on the card even
  when the account holds no open positions.

  @AC-3 @FR-2 @feature-157
  Scenario: Offline accounts appear alongside broker accounts in the account selector
    Given a user with one Alpaca account "alpaca-default" and one offline account "My IRA (offline)"
    When the /trader account selector loads
    Then both accounts are listed
    And selecting the offline account shows its portfolio card via ListPortfolios keyed by that account_id

  # Extended by feature 240 (C-16, operator sign-off 2026-10-19): the row is relabelled and a lifetime row is added.
  @AC-13 @FR-6 @feature-157 @feature-240
  Scenario: Offline realized P&L survives a full position close and is shown on the account card
    Given an offline account whose only position was closed for a realized gain of 97.50
    When the /trader portfolio card for that offline account loads
    Then the card shows "Realized (since snapshot)" = 97.50 even though the account has no open positions
    And it shows "Realized (lifetime)" = 97.50
