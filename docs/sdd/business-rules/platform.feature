# Cross-cutting / platform-wide business rules — the behavioral sibling of the PLAT-* structural
# invariants in docs/context-constitution.md. Rules that span more than one service live here;
# single-service rules live in services/xstockstrat-<svc>/acceptance/*.feature.
#
# Populated by scenario PROMOTION when a launched feature's acceptance.feature carries a cross-cutting
# guarantee (Constitution C-16). Source-feature provenance is carried on each scenario's `@feature-N` tag.

Feature: Platform-wide guarantees
  Cross-service behavioral rules the platform must preserve across features.

  @AC-8 @FR-7 @feature-147
  Scenario: MCP_AGENT_SECRET is absent from the codebase and deploy surfaces
    Given the repository is checked out
    When the repository is grepped for "MCP_AGENT_SECRET"
    Then there are no matches in service code, docker-compose.yml, .do/app.yaml, .do/app.dev.yaml, the deploy workflows, or do-inject-prod-secrets.py

  @AC-1 @FR-1 @FR-2 @feature-127
  Scenario: A watchlist-direction signal adds the symbol to the caller's system-managed watchlist
    Given the authenticated caller "user-42" has no NVDA entry in their system-managed signals watchlist
    When ingest_signal is called with direction="watchlist" for symbol "NVDA" and the response has deduplicated=false
    Then NVDA appears in the caller's system-managed signals watchlist bindings
    And that binding's source is WATCHLIST_ENTRY_SOURCE_SIGNAL

  @AC-2 @FR-6 @feature-127
  Scenario: Non-watchlist directions cause no watchlist mutation
    When ingest_signal is called with direction="buy" for symbol "NVDA"
    Then no watchlist binding is created or changed for the caller

  @AC-3 @FR-4 @feature-127
  Scenario: A deduplicated ingest does not re-trigger the auto-add
    When ingest_signal is called with direction="watchlist" for symbol "NVDA" and the response has deduplicated=true
    Then no watchlist binding is created or changed for the caller

  @AC-7 @FR-8 @FR-9 @feature-127
  Scenario: A system-managed watchlist cannot be deleted via API or UI
    Given the caller "user-42" owns a system_managed watchlist
    When DeleteWatchlist is called for that watchlist
    Then the RPC returns FAILED_PRECONDITION
    And the watchlist still exists
    And on /insights/watchlists the delete affordance for that watchlist is hidden or disabled
    And its rename, add-symbol, and remove-symbol affordances remain enabled

  @AC-5 @FR-4 @feature-149
  Scenario: Every documentation surface reflects the widened manage_strategy input type
    Given the manage_strategy change has been applied
    When the manage_strategy docstring, docs/runbooks/mcp-tools.md, and the strat-lab backtest skill are read
    Then each states that entry_rule/exit_rule accept a JSON string or a JSON object (dict)

  @AC-15 @FR-1 @feature-157
  Scenario: Deregistering an offline account purges its positions and realized P&L
    Given an offline account with open positions and recorded realized P&L
    When the user deregisters that offline account
    Then an account.deregistered event is emitted for that account_id
    And the account's positions and its offline_account_realized row are removed
    And the account no longer appears in ListBrokerAccounts

  @AC-18 @FR-8 @feature-163
  Scenario: Deregistering an offline account purges its baseline rows
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When the OFFLINE account "acc-1" is deregistered
    Then no offline_position_baselines rows remain for account "acc-1"
    And the deregistration also purges the account's positions and realized P&L
