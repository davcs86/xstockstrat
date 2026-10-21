# Feature: fix-getpnl-source-service

**Type**: bug
**Development Branch**: `feature/fix-getpnl-source-service`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings, 4 notes; overlap WARN, 10 same-file collisions, no FAIL) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (9 rounds, full) and approved under operator standing authorization; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | TBD (/sdd-spec) |
| `xstockstrat-trading` owner | Order execution correctness, fill detection | Only if design adds a shared source-service constant consumed by trading |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering | Read-only evidence (exact-match `source_service` filter); no change expected |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (9 rounds, full)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-getpnl-source-service`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`PortfolioService.GetPnL` queries ledger fills with `SourceService: "trading"`, but trading stamps
`"xstockstrat-trading"` and the ledger filters by exact match, so `realized_pnl` is always 0 with no error.

## Next Action

`/sdd-spec fix-getpnl-source-service` — generate implementation spec from the approved design (first append AC-4..AC-22 + FR-4/FR-5 per design.md §6F; see context.md Open Threads)
