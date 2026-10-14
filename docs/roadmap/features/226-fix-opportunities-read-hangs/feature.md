# Feature: fix-opportunities-read-hangs

**Type**: bug
**Development Branch**: `feature/fix-opportunities-read-hangs`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-14-opportunities-read-hangs-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-14
**Last Updated**: 2026-10-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-14 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-14-opportunities-read-hangs-defect.md` |
| 2026-10-14 | `draft` → `design-approved` | /sdd-design | Full mode, 6 rounds (round 6 by operator cap override); operator approved round-6 design |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — codebase dossier, existing business rules (C-16)
- [Design](design.md) — approved design (6 rounds), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-opportunities-read-hangs`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The Decide-queue read (`ListOpportunities`, via the agent's `list_opportunities` tool and the UI) hangs past client
timeouts with no log line. No hop on its path has a deadline, and marketdata `BatchGetLatestPrice` discards its errors.

## Next Action

`/sdd-spec fix-opportunities-read-hangs`
