# Feature: fix-getpnl-source-service

**Type**: bug
**Development Branch**: `feature/fix-getpnl-source-service`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md` |

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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-getpnl-source-service`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`PortfolioService.GetPnL` queries ledger fills with `SourceService: "trading"`, but trading stamps
`"xstockstrat-trading"` and the ledger filters by exact match, so `realized_pnl` is always 0 with no error.

## Next Action

`/sdd-design fix-getpnl-source-service` — recommended design depth: full (3 affected services in the report; fix site likely portfolio-only — operator may downgrade to quick); see context.md
