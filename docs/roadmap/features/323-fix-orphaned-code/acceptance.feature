Feature: fix-orphaned-code (bug fix)
  Regression guard for defect report: orphaned modules, scripts and dependencies across services.

  # guards: docs/reports/2026-10-19-orphaned-code-defect.md
  @AC-1 @regression
  Scenario: The portfolio repository built on a mock DB serves GetSnapshot without panicking
    Given a PortfolioRepo constructed with NewPortfolioRepoWithDB over a pgxmock pool
    When GetSnapshot is called
    Then it queries through the mock and returns a result or a mock error, with no nil-pointer panic

  # guards: docs/reports/2026-10-19-orphaned-code-defect.md
  @AC-2 @regression
  Scenario: Orphaned modules, scripts and dependencies are gone
    Given the orphaned items listed in the report (config configWatcher.ts, ledger migrate script, notify jsonwebtoken and bcrypt, marketdata AlpacaAsset, ingest example_simple_email.py and noop.py, agent signal_extraction.md)
    When the repository is searched for each item
    Then none of them exists and every affected service still builds and passes its tests

  # guards: docs/reports/2026-10-19-orphaned-code-defect.md
  @AC-3 @regression
  Scenario: The live agent config package survives the cleanup
    Given the agent imports app.config.watcher at startup (app/main.py) and for formula deadlines (app/client.py)
    When the cleanup lands
    Then services/xstockstrat-agent/app/config/watcher.py still exists
    And the agent's tests/test_config_watcher.py passes
