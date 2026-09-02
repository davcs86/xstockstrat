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

  @AC-1 @FR-1 @FR-2 @feature-021
  Scenario: Date-range export streams every event as NDJSON in global-sequence order
    Given the ledger holds 1,200 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And the "Content-Type" is "application/x-ndjson"
    And the body contains 1,200 newline-delimited JSON objects, one per event in that window
    And the objects appear in ascending ledger global-sequence order

  @AC-2 @FR-2 @feature-021
  Scenario: CSV format returns a header row and one data row per event
    Given the ledger holds 3 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31&format=csv"
    Then the response status is 200
    And the "Content-Type" is "text/csv"
    And the first line is the header "event_id,event_type,occurred_at,source_service,correlation_id,sequence,stream_key,user_id,payload"
    And 3 data rows follow, one per event

  @AC-7 @FR-6 @feature-021
  Scenario: A one-million-row export streams without buffering the full result set
    Given the ledger holds 1,000,000 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And all 1,000,000 rows are streamed to the client
    And the ledger reads rows from a DB cursor and emits them on the ExportEvents stream, and the BFF pipes each message straight to the HTTP response, so neither process buffers the full result set

  @AC-10 @FR-4 @feature-029
  Scenario: A per-fill fee flows through the fee-capture plumbing into the net win test
    Given a fill carrying a $1.20 fee on the "order.filled" event payload
    And that fill fully closes a position whose gross realized P&L is $1.00
    When the portfolio realized-P&L fold accumulates the fee and seals the position
    Then the "portfolio.position.closed" event carries fees_total=$1.20 and an unchanged gross realized_pnl=$1.00
    And analysis persists fees_total=$1.20 on the pnl_positions row
    And GetAttribution's win test uses net = $1.00 - $1.20 = -$0.20 and counts the trade as a loss

  @AC-3 @FR-2 @feature-110
  Scenario: A blank quantity on the symbol-page ticket triggers the auto-sizing path
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence of 0.82 attached via the signalConfidence prop
    When the trader submits the ticket with the quantity field left blank
    Then the blank quantity is coerced to 0 (never NaN) and the PlaceOrder request is sent with qty <= 0 and confidence 0.82, and the trading service computes the quantity via ComputePositionSize rather than rejecting the order

  @AC-8 @FR-5 @feature-110
  Scenario: The symbol-page OrderForm reaches PlaceOrder while the plain /trader form's blank-qty path does not auto-size
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence attached and the quantity field left blank
    And the plain /trader order form for "CAPR" (no signalConfidence prop) with the quantity field left blank
    When each is submitted
    Then the symbol-page OrderForm sends a PlaceOrder request that routes into 023's auto-sizing path (qty <= 0 with the real confidence)
    And the plain /trader form sends no PlaceOrder request and is rejected with a "quantity required" validation error, so it never auto-sizes
