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
| 2026-11-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |
| 2026-11-13 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); main-dev d5de836b merged, steps 2,3,6 re-specced (conditional) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency (Steps 1-2) |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety (Steps 3-6) |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output (Step 7) |

---

## Summary

Two Go services collapse distinct error classes into gRPC `INTERNAL`: marketdata's `toGRPCError` maps only six connect codes (and several RPCs return raw errors), and portfolio's `CreateWatchlist` reports a duplicate-name unique violation as `INTERNAL` instead of `ALREADY_EXISTS`.

## Next Action

`/sdd-review fix-grpc-status-mapping impl-spec` — validate implementation spec, then `/sdd-execute fix-grpc-status-mapping`
