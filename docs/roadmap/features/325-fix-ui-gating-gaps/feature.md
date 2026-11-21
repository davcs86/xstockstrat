# Feature: fix-ui-gating-gaps

**Type**: bug
**Development Branch**: `feature/fix-ui-gating-gaps`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md, docs/reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 5 steps, two atomic units (Steps 1+2, Steps 3+4) and one docs step
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-20: the distinct `**Reviewers**` across the 5 steps of
implementation-spec.md, per docs/runbooks/reviewer-registry.md. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Config mutation safety, environment (`production`/`staging`) scope correctness, analytics display accuracy, Connect-RPC call safety (Steps 1 to 4) |

Step 5 is `docs`: no reviewer.

---

## Summary

Two xstockstrat-ui display gaps: the config-ui namespace editor shows Edit/Save to non-admins, and the
watchlist "in queue" flag only sees the first loaded opportunity page.

## Next Action

`/sdd-review fix-ui-gating-gaps impl-spec` — validate implementation spec, then `/sdd-execute fix-ui-gating-gaps`
