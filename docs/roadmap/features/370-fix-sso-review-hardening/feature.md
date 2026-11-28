# Feature: fix-sso-review-hardening

**Type**: bug
**Development Branch**: `claude/345-sso-security-nits`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-28-sso-review-hardening-nits-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-28
**Last Updated**: 2026-11-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-28 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `2026-11-28-sso-review-hardening-nits-defect.md` |
| 2026-11-28 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps (design optional for Track C; not run) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Five defense-in-depth fixes from the independent security review of feature 345 (PR #1637): UI
middleware identity-header stripping, identity SSO RPCs refusing in `auth.mode` `local`, link
transaction bound to the session's refresh-token hash, SSO cookie hygiene, agent JWKS `use` filter.

## Reviewers

| Role | Focus |
|---|---|
| ui owner | auth edge |
| identity owner | auth RPCs |
| agent owner | MCP auth |

## Next Action

`/sdd-execute fix-sso-review-hardening sequential` — single integration PR to `main-dev`
