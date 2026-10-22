# Feature: fix-ingest-poller-backfill

**Type**: bug
**Development Branch**: `feature/fix-ingest-poller-backfill`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ingest-poller-backfill-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ingest-poller-backfill-defect.md` (debt-radar D-09, D-34, D-42, D-59) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; overlap WARN vs 244/259) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. FR-1 amended + `@AC-8` appended (operator gate decision) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | TBD (/sdd-spec) — poller (D-09, D-42, D-59), backfill cancel/resume (D-34) |
| `xstockstrat-config` owner | Secret encryption + redaction, WatchConfig stream stability | Read-only: client-side `GetSecret` deadline only (D-42); no server change expected |
| Security | Secrets via `GetSecret` gated by `x-internal-caller` | D-42 touches the `GetSecret` call path; confirm a deadline error never logs the bearer or key material |
| DBA | Migration numbering, index correctness | Only if design persists cancellation in a new column (D-34) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ingest-poller-backfill`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The ingest `mcp_client` poller drops a whole batch on one bad item, stalls every source on a hung `GetSecret` (no
deadline), and ingests nothing when the result's first list key is not the signal list. A backfill canceled while
`QUEUED` is overwritten to `RUNNING`, and resume revives canceled jobs after a restart.

## Next Action

`/sdd-spec fix-ingest-poller-backfill` — generate implementation spec from the approved design
