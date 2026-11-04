# Promoted from docs/roadmap/features/244-fix-python-config-stored-zero/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-244` tag.
# Durable business rule xstockstrat-ingest guarantees for a stored-zero backfill concurrency.

Feature: xstockstrat-ingest - backfill concurrency keeps its zero clamp
  What xstockstrat-ingest guarantees when ingest.backfill.max_concurrent_jobs is stored as 0.

  @AC-5 @FR-3 @regression @feature-244
  Scenario: Ingest's backfill job concurrency keeps its zero clamp
    Given "ingest.backfill.max_concurrent_jobs" is stored as the int value 0
    When the ingest servicer builds its backfill job semaphore
    Then the semaphore admits 3 concurrent jobs
