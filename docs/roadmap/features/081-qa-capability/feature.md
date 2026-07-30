# Feature: qa-capability

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/qa-capability`
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-29 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick). Adversary returned BLOCKED on an F-04 breach (`gh issue create` — Issues disabled on this repo); resolved by re-scoping to `docs/reports/` + `/sdd-triage --from-report`. recon.md + design.md written |
| 2026-07-29 | `design-approved` → `code-completed` | direct implementation | Implemented as 3 atomic commits per the user-approved plan, **bypassing `/sdd-spec` and `/sdd-execute`** — see context.md § pipeline deviation. All 13 acceptance criteria in product-spec.md verified; PR #811 open against `main-dev`, rebased past #810 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance (revised post-design)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — chosen approach, rejected alternatives, Floor breach and resolution
- **Implementation Spec — deliberately not generated.** The user-approved plan implemented directly
  as 3 atomic commits instead of routing through `/sdd-spec` → `/sdd-execute`. Its absence is a
  recorded decision, not an oversight; the step-level guarantees it would have provided were met
  another way (see context.md § pipeline deviation). Do not run `/sdd-spec` for this feature.
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the frontend-only `/test-data` fixture steward with a monorepo-wide QA capability: a
read-only `qa-tester` subagent that designs tests, inventories coverage, and reports defects, plus a
write-capable `sdd-qa` skill that writes tests, runs suites, detects flakes, and records defects to
`docs/reports/` for `/sdd-triage --from-report`. Appends Constitution **C-13** (language-agnostic
test data, canonical home named per language) and narrows **C-12** to a pointer.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Appending Constitution **C-13** and narrowing **C-12**; the **P-01** boundary between the advisory `qa-tester` subagent and the write-capable `sdd-qa` skill; the boot interlock keeping `sdd-qa` out of a live `/sdd-execute` step's `**Files**` (**F-08**, **F-10**) |

**No service-owner gate.** The design dropped the `playwright.config.ts` edit in favour of
per-invocation CLI flags, so the only `services/**` touches are two comment lines in
`services/xstockstrat-ui/e2e/fixtures/` repointing `/test-data` → `sdd-qa`. Per the registry's Step
Category matrix, `docs` steps require no reviewer.

## Next Action

Review and merge **PR #811** into `main-dev`. No `/sdd-spec` or `/sdd-execute` step is pending —
implementation is complete and the branch is rebased past #810 with no merge-order blockers.

Two acceptance items remain unexecuted and are marked as such in the PR: `sdd-qa flake` end-to-end
(needs a built Next.js app plus browsers) and the 12-service `sdd-qa gaps` sweep.
