# Feature: fix-grpc-status-mapping

**Type**: bug
**Development Branch**: `feature/fix-grpc-status-mapping`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md, docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-grpc-status-mapping`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two Go services collapse distinct error classes into gRPC `INTERNAL`: marketdata's `toGRPCError` maps only six connect codes (and several RPCs return raw errors), and portfolio's `CreateWatchlist` reports a duplicate-name unique violation as `INTERNAL` instead of `ALREADY_EXISTS`.

## Next Action

`/sdd-spec fix-grpc-status-mapping` — generate implementation spec from the approved design
