# Promoted from docs/roadmap/features/323-fix-orphaned-code/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-323` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent — live config watcher package survives orphaned-code cleanup (bug fix)
  Regression guard for defect report: orphaned modules, scripts and dependencies across services.

  # guards: docs/reports/2026-10-19-orphaned-code-defect.md
  @AC-3 @regression @feature-323
  Scenario: The live agent config package survives the cleanup
    Given the agent imports app.config.watcher at startup (app/main.py) and for formula deadlines (app/client.py)
    When the cleanup lands
    Then services/xstockstrat-agent/app/config/watcher.py still exists
    And the agent's tests/test_config_watcher.py passes
