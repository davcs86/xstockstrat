# Feature: fix-config-stream-resilience

**Type**: bug
**Development Branch**: `feature/fix-config-stream-resilience`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-config-stream-resilience-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-config-stream-resilience-defect.md` (debt-radar D-05, D-06, D-35, D-58) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; overlap WARN, file-level only) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-10-29 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 3, 4, 5, 8, 2, 1, 9 re-aligned with the codebase after the main-dev merge (setConfig anchors +2; feature 252 runner landed, so the Step 8 precondition passes) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), collected from the per-step `**Reviewers**` in `implementation-spec.md`.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-config` owner | WatchConfig stream stability, environment / global-per-user scoping, secret redaction on every broadcast | 1, 2, 3, 4, 5, 6 |
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 7, 8 |
| none (docs) | — | 9 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Config's LISTEN client has no error/end handling or reconnect (silent platform-wide config freeze), config
`getConfig`/`setConfig` and ledger `appendEvent` await the DB outside `try` (hung RPCs), and `WatchConfig`
registration and broadcast drop or never register subscribers on error without ending their call (stale streams
that never reconnect).

## Next Action

`/sdd-review fix-config-stream-resilience impl-spec` — validate implementation spec, then `/sdd-execute fix-config-stream-resilience`
