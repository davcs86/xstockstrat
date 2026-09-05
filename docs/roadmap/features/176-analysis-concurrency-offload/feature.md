# Feature: analysis-concurrency-offload

**Development Branch**: `feature/analysis-concurrency-offload`
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track A |
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 advisory warnings, deferred to design); overlap CLEAN |
| 2026-09-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, extended); round-3 adversary SOUND; recon.md + design.md written |
| 2026-09-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-09-05 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (config/docs registration) landed; sequential-mode execution started |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, Patterns to REUSE, Existing Business Rules
- [Design](design.md) — chosen approach, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with codebase evidence
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
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (Steps 1, 4–11) |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution (Steps 1–3) |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), scoping, no-seed registration (Step 1 `config`) |

## Next Action

`/sdd-review analysis-concurrency-offload impl-spec` — validate implementation spec, then `/sdd-execute analysis-concurrency-offload`
