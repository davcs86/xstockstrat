# Feature: spec-hygiene-guards

**Development Branch**: `feature/spec-hygiene-guards`
**Created**: 2026-11-05
**Last Updated**: 2026-11-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-05 | `idea` → `draft` | /sdd-story | Product spec generated from the PR #657 delta reconciled against `main-dev` `b371a3e` |
| 2026-11-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after 3 rounds; overlap WARN-only) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec spec-hygiene-guards`_
- [Context Log](context.md) — session history, decisions, deviations, and the full PR #657 finding-by-finding disposition

---

## Summary

Distils the still-valid residue of the June 2026 spec-to-implementation audit (PR #657) after reconciling it with current `main-dev`: a CI gate against duplicate feature numbers (with a shrink-only grandfather list and one renumber) and a correction of the root `CLAUDE.md` ledger/notify dependency edges. The `alpaca-default` fallback residual is already tracked as an open defect report and is routed through `/sdd-triage`, not this feature.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Inter-service dependency graph correctness (FR-4); service registry consistency |
| _(docs / CI steps)_ | None per the Step Category matrix (`docs`) |

## Next Action

`/sdd-design spec-hygiene-guards` — full design recommended: the overlap pass found warning-level collisions on `.github/workflows/ci.yml` and root `CLAUDE.md` with features 295/297, which the rubric treats as an escalate signal (no proto, schema or service signal fires). Design must pin the FR-5 missing-head-allowlist behavior (treat as empty/error, never skip), re-verify the AC-5 service lists against code, and pin the AC-7 fixture shape.
