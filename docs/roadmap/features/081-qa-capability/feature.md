# Feature: qa-capability

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/qa-capability`
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-29 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick). Adversary returned BLOCKED on an F-04 breach (`gh issue create` — Issues disabled on this repo); resolved by re-scoping to `docs/reports/` + `/sdd-triage --from-report`. recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance (revised post-design)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — chosen approach, rejected alternatives, Floor breach and resolution
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec qa-capability`_
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

`/sdd-spec qa-capability` — generate the implementation spec from the approved design
