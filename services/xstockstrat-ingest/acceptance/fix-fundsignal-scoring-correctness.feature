# Promoted from docs/roadmap/features/309-fix-fundsignal-scoring-correctness/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-309` tag.
# Durable business rules xstockstrat-ingest guarantees: an explicit mcp_client conviction of 0.0 is stored
# as 0 — a rule enters only by promotion, never by hand-authoring.

Feature: fix-fundsignal-scoring-correctness (bug fix)
  Regression guard: explicit zero conviction stays zero on ingest.

  # guards: docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md
  # extends: services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature @AC-4 @feature-166 (design.md § Business Rules Touched)
  @AC-5 @regression @feature-309
  Scenario: An mcp_client item with an explicit conviction of 0.0 is ingested as 0.0
    Given an active "mcp_client" source whose tool returns one item with symbol "AAPL", direction "buy" and conviction 0.0
    When xstockstrat-ingest runs a query cycle for that source
    Then IngestSignal is invoked with an ExternalSignal of conviction 0.0 and conviction_provided true
    And the signal is stored with conviction 0, not NULL
