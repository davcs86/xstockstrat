# Durable business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 313's
# acceptance.feature (fix-system-identity-paths) at launch; @feature-313 marks provenance. These are the
# guarantees a future feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: xstockstrat-analysis - a system-owned order event degrades instead of raising
  The P&L pattern consumer yields a partial snapshot for a system-owned order event; it is never retried or parked on that basis alone.

  # guards: docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md
  @AC-2 @FR-2 @regression @feature-313
  Scenario: A system-owned order event yields a partial P&L snapshot
    Given an order.filled ledger event whose payload has user_id "system"
    When PnLPatternConsumer processes the event
    Then the event is processed on its first attempt with no retry backoff
    And an order_snapshots row is written for that order with empty indicators and signals
    And an analysis.snapshot.degraded event is emitted
    And no pnl_positions window is opened
    And the event is not parked
