# Feature: fix-gapsonly-backfill-is

**Type**: bug
**Development Branch**: `feature/fix-gapsonly-backfill-is`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-25
**Last Updated**: 2026-11-26
**Committed to main**: 5eeca9c8d00bc549c14dcd852862574d806b0fd2
**Launched date**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-25 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md` |
| 2026-11-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 19 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |
| 2026-11-26 | `in-progress` → `code-completed` | /sdd-execute | All 19 steps done (Step 19 last); `check-config-wiring.mjs --final` exit 0 |

| 2026-11-27 | `code-completed` → `launched` | CI workflow | Promoted via PR #1633; committed 5eeca9c8d00bc549c14dcd852862574d806b0fd2 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` (2026-11-26).

| Reviewer | Focus | Steps |
|---|---|---|
| packages/proto owner | Field number uniqueness, backward compatibility, naming conventions | 1, 2, 7, 8 |
| Proto Reviewer | Field number uniqueness per message, no breaking changes, `buf lint` / `buf breaking` pass | 7, 8 |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 3, 4, 5, 6 |
| xstockstrat-ingest owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 7, 8, 9, 10, 11, 12, 13, 14 |
| xstockstrat-ui owner | Trading UI correctness, Connect-RPC call safety | 15, 16 |
| xstockstrat-agent owner | MCP tool contract stability (return shape) and `docs/runbooks/mcp-tools.md` parity | 17, 19 |

---

## Summary

GAPS_ONLY backfill derives gaps only from a symbol's earliest/latest bar, so an interior hole (e.g.
2026-04-01..2026-09-25 on homelab SCHW/IDXX) is never fetched and the job still reports COMPLETED.

## Next Action

`/sdd-review fix-gapsonly-backfill-is impl-spec` — validate implementation spec, then `/sdd-execute fix-gapsonly-backfill-is`
