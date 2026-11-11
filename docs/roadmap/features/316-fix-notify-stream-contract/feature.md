# Feature: fix-notify-stream-contract

**Type**: bug
**Development Branch**: `feature/fix-notify-stream-contract`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md, docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-notify-stream-contract`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

notify's `StreamAlerts` fan-out has two contract gaps: the subscriber severity filter is typed `number[]` while
string enums arrive at runtime (tested only with numbers), and `call.write()` backpressure is ignored, so a stalled
client buffers every alert in notify's memory without bound.

## Next Action

`/sdd-design fix-notify-stream-contract` — full design recommended (overlap with 312/323/324 on notify)
