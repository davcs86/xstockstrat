# Feature: fix-identity-ledger-test-suites

**Type**: bug
**Development Branch**: `feature/fix-identity-ledger-test-suites`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-20
**Last Updated**: 2026-10-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings, 3 notes; overlap WARN) |
| 2026-10-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-10-28 | (no status change) | /sdd-execute sequential (re-spec) | Steps 1, 2, 3, 4, 6 re-spec'd against `origin/main-dev` @ `fa40c8a4` (#1262 now on main-dev; ci.yml, ci-overview.md, merge-order.md, fails.md anchors shifted) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; up-front confirmation by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-20). Stable unless `/sdd-spec` re-runs. Steps 1 and 6 are `docs` (no reviewer).

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) | 2 (service), 3 (test) |
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 4 (service), 5 (test) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier (reuse patterns, business rules, risks)
- [Design](design.md) — approved design (chosen approach, rejected alternatives, open risks, requirement amendment)
- [Implementation Spec](implementation-spec.md) — 6 numbered steps with codebase evidence and per-step reviewers
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The identity and ledger unit suites run `node --experimental-strip-types` over `src/`, lazy-import a
`../grpc/<impl>.js` that does not exist, and early-return when the import fails. Every impl-level test
therefore passes without executing, in CI and locally.

## Next Action

`/sdd-review fix-identity-ledger-test-suites impl-spec` — validate implementation spec, then `/sdd-execute fix-identity-ledger-test-suites`
(Step 1 — the C-15 requirement amendment — must be on the feature branch before that review; see `implementation-spec.md` § Step Dependencies.)
