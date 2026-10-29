# Feature: fix-identity-auth-code-race

**Type**: bug
**Development Branch**: `feature/fix-identity-auth-code-race`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-identity-auth-code-race-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-identity-auth-code-race-defect.md` (debt-radar D-23 auth-code half, D-21 residual) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN with 252) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (here: single-use auth-code semantics, transaction correctness, unchanged claim shape and TTL) | 1, 2, 3, 4, 5 |
| Security | JWT claims minimal, auth scope (an authorization code is redeemable exactly once; claims unchanged by the D-21 dedup) | 1, 2, 3, 4 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ExchangeAuthCode` checks `consumed_at` in JS after an unlocked SELECT and then consumes with an unconditional
UPDATE, so concurrent exchanges of one code each mint a grant; the residual first-party mint/refresh-issue
duplication (D-21) is folded in so the fix covers one shared path.

## Next Action

`/sdd-review fix-identity-auth-code-race impl-spec` — validate implementation spec, then `/sdd-execute fix-identity-auth-code-race`
