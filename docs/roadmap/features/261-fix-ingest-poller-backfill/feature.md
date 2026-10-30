# Feature: fix-ingest-poller-backfill

**Type**: bug
**Development Branch**: `feature/fix-ingest-poller-backfill`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ingest-poller-backfill-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ingest-poller-backfill-defect.md` (debt-radar D-09, D-34, D-42, D-59) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; overlap WARN vs 244/259) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. FR-1 amended + `@AC-8` appended (operator gate decision) |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-10-29 | `implementation-ready` (re-spec) | /sdd-execute (sdd-batch-execute) | Steps 1–9 re-aligned with the current codebase after the main-dev merge: line-anchor drift; 244 merged, so Step 5 passes its `int_positive` timeout; Step 9 drops the duplicate key-form defect report |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by the operator's standing authorization (session_01NpS3HShZK6pSnogA7CFo2f, 2026-10-28/29); checkpoints `report`; C-16 promotion auto-confirmed unless it changes an existing `@AC` rule |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute sequential (sdd-batch-execute) | All 9 steps done; C-16 promotion applied (8 NEW scenarios → `services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`); integration PR opened, merge held for operator |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), collected from the per-step `**Reviewers**` lines in `implementation-spec.md`.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, backfill lifecycle correctness | 1, 2, 3, 4, 5, 6, 7, 8 |
| Security | `GetSecret` gated by `x-internal-caller`; a deadline error never logs the bearer or key material | 5, 6 |

`xstockstrat-config` owner: no step (the `GetSecret` server is read-only in this feature). DBA: no step (no migration; the persisted-status approach was chosen). Step 9 (docs): none.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved approach, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The ingest `mcp_client` poller drops a whole batch on one bad item, stalls every source on a hung `GetSecret` (no
deadline), and ingests nothing when the result's first list key is not the signal list. A backfill canceled while
`QUEUED` is overwritten to `RUNNING`, and resume revives canceled jobs after a restart.

## Next Action

`/sdd-execute fix-ingest-poller-backfill sequential` — all 9 steps done 2026-10-29; next: C-16 promotion + integration PR (record the manual context-constitution reconciliation in its body)
