# Feature: fix-config-ui-env

**Type**: bug
**Lifecycle Status**: `launched`
**Committed to main**: e9d8d9144fb228568b3d71d088ad0d4e26bd0c24
**Launched date**: 2026-08-07
**Development Branch**: `feature/fix-config-ui-env`
**GitHub Issue**: docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md (GitHub Issues disabled on this repo — see `docs/CLAUDE.md`)
**Severity**: SEV-2
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md |
| 2026-08-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-08-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, quick mode) and approved; recon.md + design.md written |
| 2026-08-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |
| 2026-08-07 | `implementation-ready` (unchanged) | /sdd-execute (re-spec gate) | Step 7 re-spec'd: `[namespace]/page.tsx` shifted ~5 lines from an unrelated upstream fix (`config-ui-duplicate-keys-defect`); corrected Codebase Evidence citations, clarified ambiguous move-instruction wording. No design change — content pattern matches were unaffected. |
| 2026-08-07 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done (first step of execution) |
| 2026-08-07 | `in-progress` → `code-completed` | /sdd-execute | All 8 steps done; no merge-order.md blockers; opening the single integration PR to `main-dev` |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #896; committed e9d8d9144fb228568b3d71d088ad0d4e26bd0c24 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — codebase map, patterns to reuse
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 8 steps: BFF write guard + native-scope helper (Steps 1-4), UI gating on both named consumer surfaces (Steps 5-8)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at spec time — governs this feature's review
criteria even if the registry later changes (re-run `/sdd-spec` to refresh).

| Role | Scope | Focus |
|---|---|---|
| Service Owner (xstockstrat-ui) | All 8 steps (`service` + `test`, `xstockstrat-ui` only) | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

---

## Summary

The Config UI's ENV (dev/production) and MODE (paper/live) toggle presents both options as live,
switchable choices, but dev and production are separate physical databases — selecting the
non-native `ENV` option silently writes to a database row no running deployment will ever consume,
with no indication the edit is inert.

## Next Action

`/sdd-review fix-config-ui-env impl-spec` — validate implementation spec, then `/sdd-execute fix-config-ui-env`
