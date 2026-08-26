# Promoted from docs/roadmap/features/127-consolidate-watchlist-signal/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-127` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent — ingest_signal watchlist side effect
  What the agent guarantees for the ingest_signal direction="watchlist" auto-add: the side effect is
  best-effort (a portfolio failure never fails the already-committed ingest) and stays documented on
  both the tool docstring and the mcp-tools runbook.

  @AC-4 @FR-3 @feature-127
  Scenario: A portfolio failure never fails the already-committed ingest
    Given xstockstrat-portfolio is unreachable
    When ingest_signal is called with direction="watchlist" for symbol "NVDA"
    Then the call returns successfully with a signal_id
    And no exception propagates to the ingest_signal caller
    And a WARN-level log line records the portfolio failure with its original gRPC code

  @AC-5 @FR-5 @feature-127
  Scenario: The tool docstring and mcp-tools.md both document the watchlist side effect
    When the ingest_signal docstring SIDE EFFECT block and the docs/runbooks/mcp-tools.md ingest_signal entry are read
    Then both surfaces mention the watchlist auto-add side effect
