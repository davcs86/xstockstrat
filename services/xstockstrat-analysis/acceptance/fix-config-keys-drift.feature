# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rule xstockstrat-analysis guarantees for the compute-thread bound.

Feature: xstockstrat-analysis - compute-thread bound
  What xstockstrat-analysis guarantees: a timed-out backtest never lets compute threads exceed the limit.

  @AC-23 @FR-7 @preserve @feature-295
  # Preserve-guard (C-15): today's fixed 4-thread pool already holds the bound; it must hold once the limit is live.
  Scenario: A timed-out backtest does not let compute threads exceed the limit
    Given the analysis compute limit is 4
    And 4 backtests occupy all compute slots
    When one backtest times out while its thread keeps running
    Then a fifth compute task does not start until that thread finishes
