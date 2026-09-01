# Feature: user-management-ui

**Development Branch**: `feature/user-management-ui`
**Created**: 2026-05-28
**Last Updated**: 2026-08-31
**Total Steps**: 10 (all done)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-28 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-31 | `draft` (regenerated) | /sdd-story (overwrite) | product-spec.md regenerated to current template; acceptance.feature authored |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved; all review blockers addressed |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) and approved; recon.md + design.md written |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (10 steps) |
| 2026-08-31 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–2 done — 6 admin identity RPCs + Role/User proto; stubs regenerated (buf breaking clean) |
| 2026-08-31 | `in-progress` → `code-completed` | /sdd-execute | Steps 3–10 done — authz gate, 6 admin handlers (atomic last-admin guard), ledger audit, unit 52/52, config-ui BFF + Users page + e2e 5/5 green. Integration PR opened to main-dev |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios; single source of acceptance truth (C-15)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a user management section to `xstockstrat-config-ui` backed by new admin RPCs on `xstockstrat-identity`, allowing administrators to create users, update passwords, assign roles, and deactivate accounts.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk |
| xstockstrat-identity owner | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) |
| xstockstrat-config-ui owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

Integration PR open against `main-dev` — awaiting CI + review. On merge, `/promote` handles the
C-16 scenario promotion into the identity + config-ui business-rule suites.
