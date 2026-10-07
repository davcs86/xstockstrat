# Promoted from docs/roadmap/features/187-opportunities-pagination-drain/acceptance.feature at
# archive time (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-187` tag. Durable business rule xstockstrat-analysis guarantees for ListOpportunities:
# the server-side default page size. A rule enters only by promotion from a reviewed feature
# acceptance.feature, never by hand-authoring. (AC-2/3/5/7/8 are UI guarantees promoted to the ui
# suite; AC-4 is the agent tool guarantee promoted to the agent suite; AC-6 is withheld — not enforced, see 187 context.md.)

Feature: opportunities-pagination-drain (analysis-service guarantees)
  What xstockstrat-analysis guarantees for ListOpportunities paging: a default page size of 50 with a
  continuation token when more rows exist.

  @AC-1 @FR-1 @feature-187
  Scenario: Server default page size is 50
    Given the ListOpportunities RPC is called with no page_size specified
    When the server applies the default page size
    Then the response contains at most 50 opportunities per page
    And next_page_token is non-empty when more than 50 rows exist
