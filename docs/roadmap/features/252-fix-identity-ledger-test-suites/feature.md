# Feature: fix-identity-ledger-test-suites

**Type**: bug
**Development Branch**: `feature/fix-identity-ledger-test-suites`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md` |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it and assigns steps.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) | TBD (`/sdd-spec`) |
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | TBD (`/sdd-spec`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-identity-ledger-test-suites`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The identity and ledger unit suites run `node --experimental-strip-types` over `src/`, lazy-import a
`../grpc/<impl>.js` that does not exist, and early-return when the import fails. Every impl-level test
therefore passes without executing, in CI and locally.

## Next Action

`/sdd-design fix-identity-ledger-test-suites` — full design depth (operator: full is the minimum); see context.md
