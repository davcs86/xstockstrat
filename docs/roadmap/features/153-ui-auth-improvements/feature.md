# Feature: ui-auth-improvements

**Development Branch**: `feature/ui-auth-improvements`
**Created**: 2026-08-25
**Last Updated**: 2026-08-25
**Committed to main**: d1dd9e749e789c25f48ea86acf12ddf6ed97bd8b
**Launched date**: 2026-08-25
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-25 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-25 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written |
| 2026-08-25 | `design-approved` → `implementation-ready` | /sdd-spec | implementation-spec.md written (9 steps) |
| 2026-08-25 | `implementation-ready` → `code-completed` | /sdd-execute | All steps implemented + verified (unit 116/116, lint clean, build exit 0) |

| 2026-08-25 | `code-completed` → `launched` | CI workflow | Promoted via PR #1011; committed d1dd9e749e789c25f48ea86acf12ddf6ed97bd8b |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(2); promoted 7 scenarios → ui suite; pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — Phase 0 codebase map + patterns to reuse
- [Design](design.md) — approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ui-auth-improvements`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two `xstockstrat-ui` auth UX improvements: (1) a "remember me" control on the login form that
persists the session across browser restarts (extended session), and (2) an automatic redirect to
the login page whenever a browser data call returns Unauthorized (401 / gRPC `Unauthenticated`).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Connect-RPC call safety, auth cookie handling, no secret values rendered in UI |

## Next Action

Open the integration PR into `main-dev` (this feature was implemented on the harness branch
`claude/ui-auth-improvements-apn1ya`); after merge, `/promote` flips it to `launched`.
