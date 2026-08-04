# Context: market-data-freshness-and-quality-gate

**Feature**: `docs/roadmap/features/106-market-data-freshness-and-quality-gate/feature.md`
**Product Spec**: `docs/roadmap/features/106-market-data-freshness-and-quality-gate/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/106-market-data-freshness-and-quality-gate/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 9 ("market-data safety gate").
- Depends on `xstockstrat-marketdata` observability into quote age/session status/corporate actions
  already existing or being extended. Feeds 100 (account-trading-halt-and-kill-switch) as an
  automatic-halt trigger when staleness becomes account-wide, and coexists at the same order-path
  enforcement point as the feature-023 position-sizing engine.

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted, folded into 023)

- Feasibility re-check concluded most of this feature's scope (a standalone service-level gate with
  its own proto surface, config namespace, and DB snapshot table) is disproportionate given the actual
  need: `xstockstrat-trading`'s existing `checkPortfolioRisk`
  (`services/xstockstrat-trading/internal/service/trading.go:1288`) already reads a live quote/equity
  value at order time and is the natural place for a cheap price-sanity guard (reject on missing/
  stale/zero/negative/NaN price) to live, once 023's real sizing engine replaces today's advisory-only
  check.
- Demoted as a standalone feature to `demoted/canceled`. Recorded as a fold-in recommendation in
  `023-position-sizing-engine/context.md`: 023's implementation should reject sizing on a bad quote as
  part of its own input validation, rather than standing up a separate gate/service. The broader
  asks (spread limits, corporate-action detection, independent-reference divergence, persisted
  per-decision market-data snapshots) remain legitimate future work but are premature relative to
  023/030 landing first.
