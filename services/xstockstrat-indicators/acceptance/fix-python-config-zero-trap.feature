# Promoted from docs/roadmap/features/173-fix-python-config-zero-trap/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-173` tag.
# Durable business rules xstockstrat-indicators guarantees for present-aware config reads — a
# configured empty allow-list must deny all imports, not revert to the permissive coded default.

Feature: xstockstrat-indicators — present-aware sandbox allow-list ("" is a value, not "unset")
  What xstockstrat-indicators guarantees when an operator deliberately stores an empty string for
  indicators.sandbox.allowed_imports: the empty allow-list is honored (read via get_str_present) and
  denies all imports, rather than being swallowed into the permissive 4-module default by the falsy
  get_str zero-trap.

  @AC-4 @FR-2 @FR-3 @regression @feature-173
  Scenario: An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default
    Given the indicators config watcher has a snapshot where "indicators.sandbox.allowed_imports" is present with string value ""
    When a formula that imports numpy is executed in the indicators sandbox
    Then the import is rejected because the resolved allow-list is empty
    And the allow-list is NOT the coded default "numpy,pandas,math,statistics"
