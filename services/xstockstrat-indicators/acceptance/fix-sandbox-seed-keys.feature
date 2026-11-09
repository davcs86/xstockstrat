# Promoted from docs/roadmap/features/243-fix-sandbox-seed-keys/acceptance.feature (C-16). Do not hand-edit; provenance tags preserved.
Feature: fix-sandbox-seed-keys (indicators watcher guarantees)

  # ─── feature 296: stored keys are namespace-relative ───
  # Feature 296 (operator-signed C-16 CHANGE, davcs86 2026-11-07, 296 context.md) renames every stored key to the
  # namespace-relative form. The scenarios below are left unedited; read each listed one as follows:
  #  - 243 @AC-2: the watcher's stored row is `indicators` / `sandbox.timeout_ms` (relative, since migration R); since feature 304 the getter literal is the relative `sandbox.timeout_ms`, so it no longer depends on the alias.

  @AC-2 @FR-2 @regression @feature-243
  Scenario Outline: The indicators watcher resolves the stored full-dotted sandbox row, not the code default
    Getter-contract guard: passes on pre-fix code; the red-first proof is @AC-1, @AC-3 and @AC-4.
    Fixture values differ from the code defaults so a default cannot satisfy the Then.
    Given the WatchConfig snapshot for environment "production" carries row "<key>" with fixture value <stored>
    When xstockstrat-indicators receives its WatchConfig snapshot for namespace "indicators"
    Then the watcher property <property> returns <resolved>

    Examples:
      | key                                | stored       | property                | resolved          |
      | indicators.sandbox.timeout_ms      | 3000         | sandbox_timeout_ms      | 3000              |
      | indicators.sandbox.memory_bytes    | 100663296    | sandbox_memory_bytes    | 100663296         |
      | indicators.sandbox.allowed_imports | "numpy,math" | sandbox_allowed_imports | ["numpy", "math"] |
