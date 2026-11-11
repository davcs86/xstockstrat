Feature: fix-retired-surface-proto-cleanup (bug fix)
  Regression guard for three defect reports: retained trading_mode axis, opportunity sparkline
  removal residue, and proto contract hygiene drift.

  # guards: docs/reports/2026-10-19-trading-mode-axis-retained-defect.md
  @AC-1 @regression
  Scenario: No service sends or documents the retired trading_mode axis except the recorded trading fallback
    Given feature 147 retired the trading_mode config axis
    When the Python, Go and Node config watchers build a WatchConfigRequest
    Then none of them sets trading_mode or keeps a resolveTradingMode resolver
    And marketdata has no Paper field derived from TRADING_MODE and no unread marketdata.alpaca.paper key
    And no service CLAUDE.md lists TRADING_MODE=paper unless it names the consumer that still reads it

  # guards: docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md
  @AC-2 @regression
  Scenario: The opportunity contract and consumers reflect the client-side sparkline
    Given live opportunity enrichment calls only BatchGetLatestPrice for 30 symbols
    When the durable opportunity acceptance, analysis.proto and the agent opportunity projection are read
    Then @AC-8 no longer requires BatchGetBars for the sparkline
    And Opportunity.sparkline field 17 is marked deprecated and its field number is kept
    And the agent tool output carries no sparkline key

  # guards: docs/reports/2026-10-19-proto-contract-hygiene-defect.md
  @AC-3 @regression
  Scenario: Proto contracts carry no stalled migrations or mislabelled caller identity
    Given the packages/proto contracts at the fix commit
    When buf lint runs and the contracts are read
    Then ComputeIndicatorRequest and BatchGetBarsRequest accept the Timeframe enum with the string field deprecated
    And SnapshotOfflinePositionsRequest.user_id is marked deprecated as resolved from x-user-id
    And common.v1.Decimal and common.v1.Error are marked deprecated with a comment naming them unused
    And buf breaking against main-dev reports no breaking change
