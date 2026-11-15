# Feature: fix-symbol-page-alerts-ui

**Type**: bug
**Development Branch**: `feature/fix-symbol-page-alerts-ui`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings) |
| 2026-11-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps; FR-10 and @AC-10 added first (design D-25) |
| 2026-11-15 | `implementation-ready` → `in-progress` | /sdd-execute (sdd-batch-execute setup) | Sequential execution started; main-dev 9f8856229 merged, steps 2, 7, 9, 10 re-spec'd |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 15 numbered steps with file and symbol evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Four trader-segment display defects: the Fundamentals card overflows at mobile width, a strategy-less opportunity chip is labelled with the ticker, the header Alerts drawer never shows stored unread alerts, and a checked switch renders unchecked.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-15 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review fix-symbol-page-alerts-ui impl-spec` — validate implementation spec, then `/sdd-execute fix-symbol-page-alerts-ui`
