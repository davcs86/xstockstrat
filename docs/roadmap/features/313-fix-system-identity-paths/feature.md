# Feature: fix-system-identity-paths

**Type**: bug
**Development Branch**: `feature/fix-system-identity-paths`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md`, `docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-27
**Committed to main**: 5eeca9c8d00bc549c14dcd852862574d806b0fd2
**Launched date**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |
| 2026-11-27 | `in-progress` → `code-completed` | /sdd-execute | All 8 steps done (sequential, sdd-batch-execute) |

| 2026-11-27 | `code-completed` → `launched` | CI workflow | Promoted via PR #1633; committed 5eeca9c8d00bc549c14dcd852862574d806b0fd2 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections, petitions
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-20. Re-run /sdd-spec if registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (steps 2-3) |
| Service owner `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, newsletter source schema stability (steps 4-7) |
| none | Steps 1, 8 (docs) |

---

## Summary

Server-initiated and system-owned paths lose owner attribution: ingest's `mcp_client` poll loop writes
`ingest.signal.ingested` ledger events with a NULL owner, and analysis's P&L snapshot `_compose` raises for
a `system` owner instead of degrading.

## Next Action

`/sdd-review fix-system-identity-paths impl-spec` — validate implementation spec, then `/sdd-execute fix-system-identity-paths`
