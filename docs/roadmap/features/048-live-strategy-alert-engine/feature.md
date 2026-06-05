# Feature: live-strategy-alert-engine

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/live-strategy-alert-engine`
**Created**: 2026-06-01
**Last Updated**: 2026-06-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-01 | `idea` → `draft` | /sdd-story | Split out from `047-strategy-engine` revamp — the continuous live evaluation runtime |
| 2026-06-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings — advisory). All 5 OQs resolved: asyncio background task in analysis, polling cadence, in-memory dedup, live_enabled column + SetStrategyLive RPC, sequential evaluation cap. |
| 2026-06-05 | `spec-ready` → `draft` | scope change | Added UI scope: Live Strategies panel (FR-10, FR-11) in xstockstrat-ui /trader segment with admin toggle and strategy alert feed. Requires re-review. |
| 2026-06-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after UI scope addition (4 warnings — advisory). All overlap warnings advisory; 047/019 merge-order already recorded. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec live-strategy-alert-engine`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Continuously evaluate **active strategies** (defined by feature `047-strategy-engine`) against the
latest market data and signals, and **emit an alert** via `xstockstrat-notify` whenever a strategy's
entry or exit rule triggers. Reuses 047's shared strategy evaluator so live decisions exactly match
backtest decisions. Alerts only — no order placement.

## Dependencies

- **Hard dependency on `047-strategy-engine`**: requires the persisted `StrategyDefinition` model
  and the shared evaluator. 047 must merge first (see `docs/roadmap/features/merge-order.md`).
- Related: `010-agent-scheduler` (existing scheduled signal-extraction loop — same "continuous
  runtime" concern, different job); the live evaluation loop should follow its scheduling pattern
  where sensible rather than reinvent one.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Finalized at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Evaluator parity with backtest, determinism, no look-ahead, per-strategy live state correctness |
| `xstockstrat-notify` (service owner) | Stream delivery guarantees, alert deduplication, backpressure handling |
| `xstockstrat-marketdata` (service owner) | Live bar/quote consumption, feed idempotency |
| `xstockstrat-ingest` (service owner) | `QuerySignals` for live signal-weighting |
| `xstockstrat-ui` (service owner) | Live Strategies panel correctness, admin toggle enforcement, BFF route safety, Playwright E2E coverage |
| Platform Lead | Confirm asyncio background task in `xstockstrat-analysis` is acceptable (OQ-1 resolved); dependency-graph impact |
| Security | Trading-mode safety (alerts must never auto-execute), admin scope on enable/disable |

## Next Action

`/sdd-spec live-strategy-alert-engine` — generate implementation spec from the approved product spec
