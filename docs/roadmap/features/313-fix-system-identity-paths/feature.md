# Feature: fix-system-identity-paths

**Type**: bug
**Development Branch**: `feature/fix-system-identity-paths`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md`, `docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-system-identity-paths`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Server-initiated and system-owned paths lose owner attribution: ingest's `mcp_client` poll loop writes
`ingest.signal.ingested` ledger events with a NULL owner, and analysis's P&L snapshot `_compose` raises for
a `system` owner instead of degrading.

## Next Action

`/sdd-design fix-system-identity-paths` — full design recommended (ingest + analysis + ledger)
