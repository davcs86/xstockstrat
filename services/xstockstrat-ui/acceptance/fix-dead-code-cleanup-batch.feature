# Promoted from docs/roadmap/features/175-fix-dead-code-cleanup-batch/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-175` tag.
# Durable business rule xstockstrat-ui guarantees for Node 24 type surface compatibility.

Feature: fix-dead-code-cleanup-batch
  Regression guard: the xstockstrat-ui type surface builds against the Node 24 runtime types.

  @AC-4 @FR-3 @regression @item-7 @feature-175
  Scenario: The xstockstrat-ui type surface builds against the Node 24 types
    Given the xstockstrat-ui service (whose only type gate is `next build` — next.config.js sets no typescript.ignoreBuildErrors)
    When its package.json and the workspace lockfile are inspected and the app is built
    Then @types/node resolves to a ^24 major
    And `next build` succeeds against the Node 24 types across ui's full tsconfig include set (src plus the e2e Playwright specs)
