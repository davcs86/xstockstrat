# Feature: analysis-concurrency-offload

**Development Branch**: `feature/analysis-concurrency-offload`
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track A |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec analysis-concurrency-offload`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Parallelize the serial cross-service RPC fan-out in `xstockstrat-analysis` and move CPU-bound /
blocking work (backtest simulators, the `xstockstrat-indicators` sandbox `subprocess.run`) off the
single asyncio event loop, so Opportunities and Watchlist readiness load fast and per-user latency
stays flat as concurrent user count grows.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |

## Next Action

`/sdd-review analysis-concurrency-offload product-spec` — AI review of product spec before running /sdd-spec
