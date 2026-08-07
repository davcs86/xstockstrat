# Feature: fix-config-ui-env

**Type**: bug
**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/fix-config-ui-env`
**GitHub Issue**: docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md (GitHub Issues disabled on this repo — see `docs/CLAUDE.md`)
**Severity**: SEV-2
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md |
| 2026-08-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-08-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, quick mode) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — codebase map, patterns to reuse
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-config-ui-env`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The Config UI's ENV (dev/production) and MODE (paper/live) toggle presents both options as live,
switchable choices, but dev and production are separate physical databases — selecting the
non-native `ENV` option silently writes to a database row no running deployment will ever consume,
with no indication the edit is inert.

## Next Action

`/sdd-spec fix-config-ui-env` — generate implementation spec from the approved design
