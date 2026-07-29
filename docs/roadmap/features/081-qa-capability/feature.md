# Feature: qa-capability

**Lifecycle Status**: `draft`
**Development Branch**: `feature/qa-capability`
**Created**: 2026-07-29
**Last Updated**: 2026-07-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-29 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec qa-capability`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Upgrade the frontend-only `/test-data` fixture steward into a monorepo-wide QA capability: a
read-only `qa-tester` subagent that designs tests, assesses coverage gaps, and spots defects, plus a
write-capable `/qa` skill that writes tests, runs suites, detects flakes, and files defects as GitHub
issues for `/sdd-triage`. Absorbs `/test-data` and widens Constitution **C-12** to every language.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Constitution amendment (**C-12** widened scope) and the **P-01** boundary between the advisory `qa-tester` subagent and the write-capable `/qa` skill |
| `xstockstrat-ui` service owner | The two `services/xstockstrat-ui/**` edits — `playwright.config.ts` reporter addition and the `e2e/fixtures/` catalog/comment updates. No runtime (`src/`) code is touched. |
| _(none — `docs` category)_ | Per the registry's Step Category matrix, `docs` steps require no reviewer. The bulk of this feature is `.claude/` tooling and `docs/` governance. |

## Next Action

`/sdd-review qa-capability product-spec` — AI review of product spec before running /sdd-spec
