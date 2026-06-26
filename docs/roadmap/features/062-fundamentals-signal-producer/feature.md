# Feature: fundamentals-signal-producer

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/fundamentals-signal-producer`
**Created**: 2026-06-26
**Last Updated**: 2026-06-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 5 of 6 in the screener initiative) |
| 2026-06-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (warnings fixed: pinned analysis migrations 003/004 + up/down pairs; pgxpool→asyncpg wording. Impl-spec re-checks: analysis.proto field nums w/ 060, analysis.fundsignal.* namespace w/ 063) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-signal-producer`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A scheduled job in `xstockstrat-analysis` that, for a deduplicated symbol universe, reads cached
fundamentals (059), scores them (063), maps the score to a `buy`/`sell`/`hold` direction + conviction,
and emits it as an `ExternalSignal` from a registered `fundamentals` source via `IngestSignal` — so a
fundamental "house view" flows through the existing backtest signal-weighting, screener, and alerting
machinery with no new consumers. Designed FMP-budget-first: cache-mediated, paced, deduped, idempotent.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Additive `RunFundamentalsScan` manual-trigger RPC, `buf` pass |
| `xstockstrat-analysis` (service owner) | Scheduler loop safety (reuse of the live-engine interval), determinism, no interference with the live-strategy loop or backtest |
| `xstockstrat-ingest` (service owner) | `IngestSignal` write contract, source-registry validation, idempotent/no-duplicate ingestion, newsletter-source schema stability |
| `xstockstrat-marketdata` (service owner) | **FMP budget**: producer consumes only cached `GetFundamentalsMulti`, never FMP directly; pacing respects `marketdata.fmp.daily_request_cap` |
| DBA | New `analysis.fundsignal_runs` / `_emitted` run-state tables, idempotency uniqueness, up+down pair |
| `xstockstrat-config` (service owner) | New `analysis.fundsignal.*` keys; reuse of `analysis.signals.source_weights` |

## Next Action

`/sdd-spec fundamentals-signal-producer` — generate implementation spec
