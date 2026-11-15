# Feature: fix-commsgun-email-channel

**Type**: bug
**Development Branch**: `feature/fix-commsgun-email-channel`
**GitHub Issue**: none (Issues disabled) — report: `services/xstockstrat-notify/docs/context-constitution-findings.md` (rows "found 2026-11-15", merged in #1543 @ `d1c9727`)
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 6 findings-log rows (clustered triage; feature 338 is dev-only) |
| 2026-11-15 | `draft` → `code-completed` | fix session | TDD fix on `feature/fix-commsgun-email-channel`, single integration PR to `main-dev` (no impl-spec; see context.md) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- Implementation Spec — _not generated: design depth `skip`, fixed directly under the task's single-PR instruction (context.md)_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Five feature-338 commsgun email defects in xstockstrat-notify: no `https:` check on `commsgun.enqueue_url`,
unsanitised subjects (commsgun 422 `invalid_subject`), no standing key incident in pinned `commsgun` mode,
408 treated as permanent, three CLAUDE.md lines that say all email needs SendGrid, and (found in review) uncapped email text against commsgun's 256 KiB request limit.

## Next Action

Review and merge the integration PR into `main-dev`; the fix rides the next `/promote` together with feature 338.
