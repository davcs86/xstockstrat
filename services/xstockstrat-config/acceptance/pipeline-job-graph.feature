# Promoted from docs/roadmap/features/367-pipeline-job-graph (Constitution C-16), the EXTEND case its
# design names for @AC-14 @FR-5 @feature-295 (fix-config-keys-drift.feature); that rule is unchanged.
# Durable business rules xstockstrat-config already guarantees — a rule enters only by promotion
# from a reviewed feature, never by hand-authoring.

Feature: xstockstrat-config — pipeline job graph keys are seeded

  # Extends @AC-14 @FR-5 @feature-295: every key a service reads is seeded in both environments.
  @FR-9 @regression @feature-367
  Scenario Outline: The analysis pipeline keys are seeded in both environments at their code default
    Given the config migrations have been applied to a fresh database
    Then namespace "analysis" holds a global "<key>" row of type <type> with value <value> in "staging"
    And it holds the same row in "production"
    And the stored key is namespace-relative

    Examples:
      | key                         | type | value |
      | pipeline.worker_enabled     | bool | true  |
      | pipeline.worker_concurrency | int  | 4     |
      | pipeline.poll_interval_ms   | int  | 1000  |
      | pipeline.lease_seconds      | int  | 60    |
      | pipeline.max_attempts       | int  | 5     |
      | pipeline.retention_days     | int  | 7     |
