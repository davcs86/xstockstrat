# Promoted from docs/roadmap/features/189-screener-preset-criteria/acceptance.feature at
# integration (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-189` tag. Durable business rule: the /insights Screener lets a trader load a preset
# multi-criterion configuration (Fundamentals Signal) that replaces the criteria builder rows and
# remains fully editable.

Feature: xstockstrat-ui — /insights Screener preset criteria
  As a trader, I want to select a preset criteria configuration in the Screener,
  so that I can load a proven multi-criterion setup instantly instead of manually
  rebuilding it each time.

  @AC-1 @FR-1 @FR-5 @feature-189
  Scenario: Preset selector is visible and lists available presets
    Given the Screener page is loaded at /insights/screener
    When the trader opens the preset selector dropdown
    Then a "Fundamentals Signal" option is listed with a short description

  @AC-2 @FR-2 @FR-4 @feature-189
  Scenario: Loading the Fundamentals Signal preset populates five criteria rows
    Given the Screener page has the default single criterion row
    When the trader selects the "Fundamentals Signal" preset
    Then the criteria builder shows exactly 5 rows:
      | metric          | op | threshold | hardFilter |
      | pe_ratio        | <  | 35        | false      |
      | pb_ratio        | <  | 5         | false      |
      | roe             | >  | 0.05      | false      |
      | debt_to_equity  | <  | 2         | false      |
      | eps             | >  | 0         | true       |
    And each row has weight 1
    And all rows have kind FUNDAMENTAL

  @AC-3 @FR-6 @feature-189
  Scenario: Preset-loaded criteria are fully editable
    Given the trader has loaded the "Fundamentals Signal" preset
    When the trader changes the pe_ratio threshold from 35 to 25
    And the trader removes the eps row
    And the trader adds a new criterion row
    Then the criteria builder shows 5 rows (4 preset + 1 new)
    And the pe_ratio row threshold reads 25

  @AC-4 @FR-2 @feature-189
  Scenario: Loading a preset replaces all existing criteria
    Given the trader has 3 manually configured criteria rows
    When the trader selects the "Fundamentals Signal" preset
    Then the criteria builder shows exactly 5 rows from the preset
    And none of the 3 prior manual rows remain

  @AC-5 @FR-3 @feature-189
  Scenario: Preset definitions are importable from screenPresets module
    Given the screenPresets.ts module exports SCREEN_PRESETS
    Then each preset entry has a name, description, and a non-empty criteria array
    And each criterion in every preset references a valid FUNDAMENTAL_METRICS or BUILTIN_INDICATORS entry
