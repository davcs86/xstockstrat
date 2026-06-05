# Feature: live-strategy-alert-engine

**Lifecycle Status**: `implementation-ready`
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
| 2026-06-05 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
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

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias, per-strategy live state correctness |
| `xstockstrat-notify` (service owner) | Stream delivery guarantees, backpressure handling, alert deduplication |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-ingest` (service owner) | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access |
| Proto Reviewer | Field number uniqueness, backward compatibility, naming conventions |
| DBA | Migration NNN numbering, up+down pair present, index correctness |
| Security | Admin API key scoping on mutating MCP tools, `secret.*` handling for any credential refs |

## Next Action

`/sdd-review live-strategy-alert-engine impl-spec` — validate implementation spec, then `/sdd-execute live-strategy-alert-engine`
