@feature-183
Feature: opportunities-latency-fix — UI BFF deadline guarantee
  BFF-side gRPC deadline prevents unbounded ListOpportunities calls.

  @AC-1 @FR-1 @feature-183
  Scenario: BFF enforces a 30s gRPC deadline on ListOpportunities
    Given the BFF forwards a ListOpportunities call to xstockstrat-analysis
    When the analysis service takes longer than 30 seconds to respond
    Then the BFF returns a DEADLINE_EXCEEDED error to the browser within ~30s
    And the browser does not receive an ECONNRESET after 120s
