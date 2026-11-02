# Feature: legacy-authors-confirm-resolve

**Development Branch**: `feature/legacy-authors-confirm-resolve`
**Created**: 2026-11-02
**Last Updated**: 2026-11-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-02 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-02 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, all addressed) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec legacy-authors-confirm-resolve`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let `python -m app.maintenance.legacy_authors_ops confirm` resolve `unmappable` and `ambiguous` plan rows (via `--map LEGACY=USER_ID` flags and an interactive picker) so the feature-276 repair no longer needs a hand-edit of `plan.json` in an ephemeral DO console.

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-indicators` | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |

_No proto, migration or config change, so no Proto Reviewer, DBA or Platform Lead. The DBA change record (runbook §2) still governs any real run._

## Next Action

`/sdd-design legacy-authors-confirm-resolve quick` — quick design recommended (single service, no proto/config/DB change, no consumer surface; the only overlap is a disjoint-hunk WARN on `services/xstockstrat-indicators/CLAUDE.md` with 243)
