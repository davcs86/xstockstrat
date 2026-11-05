# Feature: fix-config-keys-contract

**Type**: bug
**Development Branch**: `feature/fix-config-keys-contract`
**GitHub Issue**: n/a. Defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md` (shared with feature 295)
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-design (295 re-scope) | Split from 295 as Release B (contract), per operator decision 13 recorded in 295's context.md |

---

## Artifacts

- [Product Spec](product-spec.md): contract half of the config-key canonicalisation
- [Acceptance Scenarios](acceptance.feature): `@AC-*`, C-15
- [Implementation Spec](implementation-spec.md): _not yet generated_
- [Context Log](context.md)

---

## Summary

This is the contract half of 295. It renames every stored config key to the namespace-relative form,
adds the DB CHECK, rewrites every getter literal to relative, rejects prefixed keys and activates
295's dormant alias. It may merge only after 295 is `launched` (merge-order row), so a rollback to
the previous images still resolves every key.

## Next Action

`/sdd-review fix-config-keys-contract product-spec`, then `/sdd-design fix-config-keys-contract`. Design must consume 295's `design.md`.
