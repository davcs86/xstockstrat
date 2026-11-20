# Feature: fix-ci-enforcement-gaps

**Type**: bug
**Development Branch**: `feature/fix-ci-enforcement-gaps`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md, docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved design
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Focus | Steps |
|---|---|---|
| Service owner (xstockstrat-config) | Config key naming, scoping, secret encryption + redaction, WatchConfig stream stability | 2, 3, 5, 6 |
| Service owner (xstockstrat-identity) | JWT expiry and rotation, API key scoping, secret store integration | 2, 3, 5, 6 |
| Service owner (xstockstrat-ledger) | Append-only invariant, event ordering, hypertable partition safety | 2, 3, 5, 6 |
| Service owner (xstockstrat-notify) | Stream delivery guarantees, backpressure handling, alert deduplication | 2, 3, 4, 5, 6 |

Steps 1, 8 and 9 (`docs`): none. Step 7 (`scripts/` proof): none; the registry has no `scripts/` or
CI-workflow owner row.

---

## Summary

Two CI gates are declared but not enforced: the Node leaves' 40% c8 line threshold (no `--check-coverage`)
and ruff lint/format over `scripts/` Python (no CI job; 9 findings, 4 files unformatted).

## Next Action

`/sdd-review fix-ci-enforcement-gaps impl-spec` — validate implementation spec, then `/sdd-execute fix-ci-enforcement-gaps`
