# Feature: ui-middleware-nodejs-runtime

**Development Branch**: `feature/ui-middleware-nodejs-runtime`
**Created**: 2026-08-11
**Last Updated**: 2026-08-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-31 | `draft` (regenerated) | /sdd-story (overwrite) | product-spec.md regenerated to current template; acceptance.feature authored |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved; all review blockers addressed |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) and approved; recon.md + design.md written; FR-5/AC-5 corrected (keep matcher exclusion) |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (4 steps) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move `xstockstrat-ui`'s `src/middleware.ts` from the Edge runtime to the Node.js runtime (stable
since Next.js 15.5) and have it call `xstockstrat-identity`'s `refreshSession()` directly, removing
the self-referential HTTP loopback to `/api/auth/refresh` landed as a hotfix in PR #925.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| Security | No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct |

## Next Action

`/sdd-review ui-middleware-nodejs-runtime impl-spec` then `/sdd-execute ui-middleware-nodejs-runtime`
