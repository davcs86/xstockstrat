# Promoted from docs/roadmap/features/323-fix-orphaned-code/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-323` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio — mock-DB repository serves GetSnapshot without panicking (bug fix)
  Regression guard for defect report: orphaned modules, scripts and dependencies across services.

  # guards: docs/reports/2026-10-19-orphaned-code-defect.md
  @AC-1 @regression @feature-323
  Scenario: The portfolio repository built on a mock DB serves GetSnapshot without panicking
    Given a PortfolioRepo constructed with NewPortfolioRepoWithDB over a pgxmock pool
    When GetSnapshot is called
    Then it queries through the mock and returns a result or a mock error, with no nil-pointer panic
