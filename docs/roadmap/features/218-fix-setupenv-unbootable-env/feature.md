# Feature: fix-setupenv-unbootable-env

**Type**: bug
**Development Branch**: `feature/fix-setupenv-unbootable-env`
**GitHub Issue**: docs/reports/2026-10-02-setupenv-unbootable-env-defect.md (GitHub Issues disabled on this repo)
**Severity**: SEV-3
**Created**: 2026-10-02
**Last Updated**: 2026-10-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-02 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report docs/reports/2026-10-02-setupenv-unbootable-env-defect.md |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-setupenv-unbootable-env`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`scripts/setup-env.sh` writes a `.env` that `docker compose` rejects: it never generates the two required encryption keys, and it still writes variables removed by feature 147.

## Next Action

`/sdd-spec fix-setupenv-unbootable-env` — recommended design depth: skip (from triage; see context.md)
