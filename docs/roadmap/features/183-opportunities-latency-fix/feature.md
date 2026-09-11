# Feature: opportunities-latency-fix

**Development Branch**: `feature/opportunities-latency-fix`
**Created**: 2026-09-08
**Last Updated**: 2026-09-09
**Committed to main**: aab3fa8de30b9f2ab7f9a9299e39570dcf9406e1
**Launched date**: 2026-09-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-09 | `draft` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written |
| 2026-09-09 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (13 steps, 9 AC scenarios covered) |
| 2026-09-09 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done (proto definitions) |
| 2026-09-09 | `in-progress` → `code-completed` | /sdd-execute | All 13 steps done (sequential mode) |

| 2026-09-11 | `code-completed` → `launched` | CI workflow | Promoted via PR #1137; committed aab3fa8de30b9f2ab7f9a9299e39570dcf9406e1 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules
- [Design](design.md) — debated architecture (4 rounds, full), chosen approach, rejected alternatives
- [Implementation Spec](implementation-spec.md) — 13 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fix the 2.9-minute ListOpportunities latency by adding batch marketdata RPCs (BatchGetBars, BatchGetLatestPrice), parallelizing sequential Phase 0 drains, aligning memo TTL with poll interval, and adding a BFF-side gRPC deadline to prevent unbounded calls that exceed the DO proxy timeout.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint`/`buf breaking` passes |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| xstockstrat-ui owner | Connect-RPC call safety, analytics display accuracy |

## Next Action

All steps complete. Create integration PR from `feature/opportunities-latency-fix` → `main-dev`.
