# Feature: fundamentals-signal-producer

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/fundamentals-signal-producer`
**Created**: 2026-06-26
**Last Updated**: 2026-06-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 5 of 6 in the screener initiative) |
| 2026-06-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (warnings fixed: pinned analysis migrations 003/004 + up/down pairs; pgxpool→asyncpg wording. Impl-spec re-checks: analysis.proto field nums w/ 060, analysis.fundsignal.* namespace w/ 063) |
| 2026-06-27 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-06-27 | `implementation-ready` | /sdd-review (impl-spec) | Resolved the ingest source_type open item (user decision): added Step 13 — additive ingest migration `006_signal_source_type_derived` adds a `derived` source_type; producer registers with `source_type='derived'` + `app.extractors.noop`. Now 13 steps. Config migration renumbered 006→008 (config-006 collision; see merge-order.md) |
| 2026-06-29 | `implementation-ready` → `code-completed` | /sdd-execute | All 13 steps implemented on `feature/fundamentals-signal-producer` (stacked on `feature/fundamentals-scoring-model`). Producer loop + `RunFundamentalsScan` RPC + migrations + config seed + ingest `derived` source_type (fail-closed validation). 125 analysis tests pass (65% cov); 29 ingest signal_sources tests pass. Universe used the `explicit` fallback (058 `ListWatchlists` is user-scoped). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 13 numbered steps with codebase evidence
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
| Proto Reviewer | Additive `RunFundamentalsScan` manual-trigger RPC + new messages; field-number uniqueness; `buf lint`/`buf breaking` pass; stub freshness |
| `xstockstrat-analysis` (service owner) | Scheduler-loop safety (reuse of the live-engine interval pattern), determinism, no look-ahead, no interference with the live-strategy loop; run-state schema; admin gate on `RunFundamentalsScan`; idempotency guard table |
| `xstockstrat-ingest` (service owner) | `IngestSignal` write contract, source-registry validation, idempotent source registration via `ManageSignalSource`, `source_type` CHECK coordination, newsletter-source schema stability |
| `xstockstrat-marketdata` (service owner) | **FMP budget**: producer consumes only cached `GetFundamentalsMulti`, never FMP directly; pacing respects `marketdata.fmp.daily_request_cap` |
| DBA | New `analysis.fundsignal_runs` / `_emitted` run-state tables, idempotency uniqueness on `(symbol, source, as_of_date)`, migration NNN numbering, up+down pairs |
| `xstockstrat-config` (service owner) | New `analysis.fundsignal.*` keys (naming, dev+prod seed rows), reuse of `analysis.signals.source_weights`, rollout safety |

## Next Action

`/sdd-review fundamentals-signal-producer impl-spec` — validate implementation spec, then `/sdd-execute fundamentals-signal-producer`
