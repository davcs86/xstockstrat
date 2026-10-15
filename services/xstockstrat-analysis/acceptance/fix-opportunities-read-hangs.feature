# Promoted from docs/roadmap/features/227-fix-opportunities-read-hangs/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-227` tag.
# Durable business rules xstockstrat-analysis already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-1 tests/test_list_opportunities_deadlines.py; @AC-4 tests/test_read_budget_real_pg.py (real_pg).

Feature: xstockstrat-analysis — opportunities read never hangs
  ListOpportunities bounds every hop: a stalled price enrichment degrades to unenriched rows, and an
  exhausted DB pool fails fast with UNAVAILABLE, both well inside the BFF's 30-second deadline.

  @AC-1 @regression @feature-227
  Scenario: A stalled price enrichment returns the stored rows unenriched within the deadline
    Given a user with stored opportunities "AAPL" and "MSFT"
    And marketdata BatchGetLatestPrice never responds
    When the user calls analysis "ListOpportunities"
    Then the call returns both rows shortly after the enrichment deadline elapses, well inside the BFF's 30-second deadline
    And the rows carry no live price
    And a warning naming "BatchGetLatestPrice" is logged

  @AC-4 @regression @feature-227
  Scenario: An exhausted analysis DB pool fails the read fast
    Given every analysis DB pool connection is held
    When the user calls analysis "ListOpportunities"
    Then it fails with status "UNAVAILABLE" at the pool-acquire timeout (within that timeout + 0.5s) and a warning is logged
