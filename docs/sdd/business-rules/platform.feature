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
