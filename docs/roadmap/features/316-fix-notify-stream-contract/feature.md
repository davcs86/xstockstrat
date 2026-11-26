# Feature: fix-notify-stream-contract

**Type**: bug
**Development Branch**: `feature/fix-notify-stream-contract`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md, docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections, reopen petitions
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

notify's `StreamAlerts` fan-out has two contract gaps: the subscriber severity filter is typed `number[]` while
string enums arrive at runtime (tested only with numbers), and `call.write()` backpressure is ignored, so a stalled
client buffers every alert in notify's memory without bound.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec time — re-run /sdd-spec if the
registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |

## Next Action

`/sdd-review fix-notify-stream-contract impl-spec` — validate implementation spec, then `/sdd-execute fix-notify-stream-contract`
